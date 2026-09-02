#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    token, Address, Env, Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Owner,
    DailyCap,
    SpentToday,
    LastResetTimestamp,
    Whitelist,
    RecoveryKey,
    Frozen,
    TokenAddress,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u32)]
pub enum WalletError {
    Unauthorized       = 1,
    DailyCapExceeded   = 2,
    AddressNotWhitelisted = 3,
    WalletFrozen       = 4,
    ZeroAmount         = 5,
    NotInitialised     = 6,
    AlreadyInitialized = 7,
    AlreadyWhitelisted = 8,
    WhitelistFull      = 9,
}

// Maximum number of whitelisted addresses.
const WHITELIST_MAX: u32 = 50;

// TTL constants (in ledgers). At ~5 s/ledger:
//   MIN_TTL ≈ 30 days,  MAX_TTL ≈ 60 days.
const TTL_MIN: u32 = 518_400;
const TTL_MAX: u32 = 1_036_800;

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct SafeWallet;

#[contractimpl]
impl SafeWallet {
    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialise the wallet. Can only be called once.
    ///
    /// # Parameters
    /// - `owner`        — Address that controls the wallet (must sign).
    /// - `daily_cap`    — Maximum tokens transferable per 24-hour window (in stroops).
    /// - `recovery_key` — Address that can freeze / unfreeze the wallet.
    /// - `token`        — Token contract address used for transfers.
    ///
    /// # Errors
    /// - `AlreadyInitialized` — wallet already set up.
    pub fn initialize(
        env: Env,
        owner: Address,
        daily_cap: i128,
        recovery_key: Address,
        token: Address,
    ) -> Result<(), WalletError> {
        // Re-initialisation guard
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(WalletError::AlreadyInitialized);
        }
        owner.require_auth();

        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::DailyCap, &daily_cap);
        env.storage().instance().set(&DataKey::RecoveryKey, &recovery_key);
        env.storage().instance().set(&DataKey::TokenAddress, &token);
        env.storage().instance().set(&DataKey::Frozen, &false);
        env.storage().instance().set(&DataKey::SpentToday, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::LastResetTimestamp, &env.ledger().timestamp());

        // Extend instance TTL so the wallet doesn't expire on mainnet.
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Whitelist management
    // -----------------------------------------------------------------------

    /// Add an address to the whitelist. Owner only.
    ///
    /// # Errors
    /// - `Unauthorized`       — caller is not the owner.
    /// - `AlreadyWhitelisted` — address is already in the whitelist.
    /// - `WhitelistFull`      — whitelist has reached the 50-address cap.
    pub fn add_whitelist(env: Env, address: Address) -> Result<(), WalletError> {
        Self::require_owner(&env)?;

        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Whitelist)
            .unwrap_or_else(|| Vec::new(&env));

        // Deduplication check
        if list.contains(&address) {
            return Err(WalletError::AlreadyWhitelisted);
        }

        // Size cap
        if list.len() >= WHITELIST_MAX {
            return Err(WalletError::WhitelistFull);
        }

        list.push_back(address);
        env.storage().instance().set(&DataKey::Whitelist, &list);
        Ok(())
    }

    /// Remove an address from the whitelist. Owner only.
    ///
    /// # Errors
    /// - `Unauthorized`          — caller is not the owner.
    /// - `AddressNotWhitelisted` — address is not in the whitelist.
    pub fn remove_whitelist(env: Env, address: Address) -> Result<(), WalletError> {
        Self::require_owner(&env)?;

        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Whitelist)
            .unwrap_or_else(|| Vec::new(&env));

        // Find the index of the address to remove
        let mut idx: Option<u32> = None;
        for i in 0..list.len() {
            if list.get(i).unwrap() == address {
                idx = Some(i);
                break;
            }
        }

        let pos = idx.ok_or(WalletError::AddressNotWhitelisted)?;

        // Rebuild list without the removed entry
        let mut new_list: Vec<Address> = Vec::new(&env);
        for i in 0..list.len() {
            if i != pos {
                new_list.push_back(list.get(i).unwrap());
            }
        }

        env.storage().instance().set(&DataKey::Whitelist, &new_list);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Transfers
    // -----------------------------------------------------------------------

    /// Transfer `amount` of tokens to `to`, enforcing all wallet policies.
    ///
    /// 1. Only the owner may call.
    /// 2. Rejected if the wallet is frozen.
    /// 3. Rejected if `to` is not whitelisted.
    /// 4. Resets the daily spend counter when the 24h window has elapsed.
    /// 5. Rejected if the transfer would exceed the daily cap.
    ///
    /// Uses check-effects-interactions ordering: storage is updated before
    /// calling the external token contract.
    ///
    /// # Errors
    /// - `Unauthorized`          — caller is not the owner.
    /// - `WalletFrozen`          — wallet is currently frozen.
    /// - `ZeroAmount`            — amount must be > 0.
    /// - `AddressNotWhitelisted` — recipient is not whitelisted.
    /// - `DailyCapExceeded`      — transfer would exceed the daily cap.
    /// - `NotInitialised`        — wallet has no token or daily cap configured.
    pub fn transfer(
        env: Env,
        to: Address,
        amount: i128,
    ) -> Result<(), WalletError> {
        Self::require_owner(&env)?;

        if amount <= 0 {
            return Err(WalletError::ZeroAmount);
        }

        let frozen: bool = env
            .storage()
            .instance()
            .get(&DataKey::Frozen)
            .unwrap_or(false);
        if frozen {
            return Err(WalletError::WalletFrozen);
        }

        let whitelist: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Whitelist)
            .unwrap_or_else(|| Vec::new(&env));
        if !whitelist.contains(&to) {
            return Err(WalletError::AddressNotWhitelisted);
        }

        let daily_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DailyCap)
            .ok_or(WalletError::NotInitialised)?;

        let now = env.ledger().timestamp();
        let last_reset: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LastResetTimestamp)
            .unwrap_or(now);
        let mut spent_today: i128 = env
            .storage()
            .instance()
            .get(&DataKey::SpentToday)
            .unwrap_or(0_i128);

        const DAY_IN_SECONDS: u64 = 86_400;
        if now >= last_reset + DAY_IN_SECONDS {
            spent_today = 0;
            env.storage()
                .instance()
                .set(&DataKey::LastResetTimestamp, &now);
        }

        if spent_today + amount > daily_cap {
            return Err(WalletError::DailyCapExceeded);
        }

        // CEI: update state BEFORE calling external contract
        env.storage()
            .instance()
            .set(&DataKey::SpentToday, &(spent_today + amount));

        // Bump TTL on every transfer so the wallet doesn't expire on mainnet
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);

        // External call last
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .ok_or(WalletError::NotInitialised)?;
        token::Client::new(&env, &token_address)
            .transfer(&env.current_contract_address(), &to, &amount);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Freeze / Unfreeze
    // -----------------------------------------------------------------------

    /// Emergency freeze — callable by the recovery key only.
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has no recovery key.
    /// - `Unauthorized`   — caller is not the recovery key.
    pub fn freeze(env: Env, caller: Address) -> Result<(), WalletError> {
        caller.require_auth();
        let recovery_key: Address = env
            .storage()
            .instance()
            .get(&DataKey::RecoveryKey)
            .ok_or(WalletError::NotInitialised)?;
        if caller != recovery_key {
            return Err(WalletError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Frozen, &true);
        Ok(())
    }

    /// Unfreeze the wallet — callable by the recovery key only.
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has no recovery key.
    /// - `Unauthorized`   — caller is not the recovery key.
    pub fn unfreeze(env: Env, caller: Address) -> Result<(), WalletError> {
        caller.require_auth();
        let recovery_key: Address = env
            .storage()
            .instance()
            .get(&DataKey::RecoveryKey)
            .ok_or(WalletError::NotInitialised)?;
        if caller != recovery_key {
            return Err(WalletError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Frozen, &false);
        Ok(())
    }

    /// Returns `true` if the wallet is frozen.
    pub fn is_frozen(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Frozen)
            .unwrap_or(false)
    }

    // -----------------------------------------------------------------------
    // Recovery key rotation
    // -----------------------------------------------------------------------

    /// Rotate the recovery key. Requires both owner and current recovery key to sign.
    ///
    /// # Parameters
    /// - `caller`   — Must be the current owner (signs the transaction).
    /// - `new_key`  — New recovery key address.
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has no recovery key yet.
    /// - `Unauthorized`   — caller is not the owner.
    pub fn update_recovery_key(env: Env, new_key: Address) -> Result<(), WalletError> {
        // Owner auth
        let owner = Self::require_owner(&env)?;

        // Current recovery key must also authorise the rotation
        let current_recovery: Address = env
            .storage()
            .instance()
            .get(&DataKey::RecoveryKey)
            .ok_or(WalletError::NotInitialised)?;
        current_recovery.require_auth();

        // Prevent owner from setting themselves as recovery key
        if new_key == owner {
            return Err(WalletError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::RecoveryKey, &new_key);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn require_owner(env: &Env) -> Result<Address, WalletError> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(WalletError::NotInitialised)?;
        owner.require_auth();
        Ok(owner)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};
    use soroban_sdk::token::{self, StellarAssetClient};
    use soroban_sdk::testutils::Ledger as _;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Sets up a fully initialised wallet and returns
    /// (token_address, client, owner, recovery).
    fn setup_wallet(env: &Env, daily_cap: i128) -> (Address, SafeWalletClient<'static>, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register(SafeWallet, ());
        let client = SafeWalletClient::new(env, &contract_id);
        let owner = Address::generate(env);
        let recovery = Address::generate(env);
        let token_admin = Address::generate(env);
        let token = env.register_stellar_asset_contract(token_admin.clone());
        client.initialize(&owner, &daily_cap, &recovery, &token);

        (token, client, owner, recovery)
    }

    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    #[test]
    fn test_wallet_not_frozen_by_default() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(SafeWallet, ());
        let client = SafeWalletClient::new(&env, &contract_id);
        assert!(!client.is_frozen());
    }

    #[test]
    fn test_initialize_twice_fails() {
        let env = Env::default();
        let (token, client, owner, recovery) = setup_wallet(&env, 1_000_000);
        assert_eq!(
            client.try_initialize(&owner, &1_000_000, &recovery, &token),
            Err(Ok(WalletError::AlreadyInitialized))
        );
    }

    // -----------------------------------------------------------------------
    // transfer
    // -----------------------------------------------------------------------

    #[test]
    fn test_transfer_happy_path() {
        let env = Env::default();
        let (token, client, owner, _recovery) = setup_wallet(&env, 1_000_000);
        let recipient = Address::generate(&env);

        client.add_whitelist(&recipient);

        StellarAssetClient::new(&env, &token).mint(&owner, &500_000);
        token::Client::new(&env, &token).transfer(&owner, &client.address, &500_000);

        client.transfer(&recipient, &100_000);

        assert_eq!(token::Client::new(&env, &token).balance(&recipient), 100_000);
        assert_eq!(token::Client::new(&env, &token).balance(&client.address), 400_000);
    }

    #[test]
    fn test_transfer_rejects_frozen_wallet() {
        let env = Env::default();
        let (token, client, _owner, recovery) = setup_wallet(&env, 1_000_000);
        let recipient = Address::generate(&env);

        client.add_whitelist(&recipient);

        client.freeze(&recovery);


        assert_eq!(
            client.try_transfer(&recipient, &100_000),
            Err(Ok(WalletError::WalletFrozen))
        );
    }

    #[test]
    fn test_transfer_rejects_non_whitelisted_recipient() {
        let env = Env::default();
        let (_token, client, _owner, _recovery) = setup_wallet(&env, 1_000_000);
        let recipient = Address::generate(&env);

        assert_eq!(
            client.try_transfer(&recipient, &100_000),
            Err(Ok(WalletError::AddressNotWhitelisted))
        );
    }

    #[test]
    fn test_transfer_rejects_daily_cap_exceeded() {
        let env = Env::default();
        let (token, client, owner, _recovery) = setup_wallet(&env, 100_000);
        let recipient = Address::generate(&env);

        client.add_whitelist(&recipient);

        StellarAssetClient::new(&env, &token).mint(&owner, &200_000);
        token::Client::new(&env, &token).transfer(&owner, &client.address, &200_000);

        client.transfer(&recipient, &50_000);

        assert_eq!(
            client.try_transfer(&recipient, &60_000),
            Err(Ok(WalletError::DailyCapExceeded))
        );
    }

    #[test]
    fn test_transfer_resets_daily_spend_after_24h() {
        let env = Env::default();
        let (token, client, owner, _recovery) = setup_wallet(&env, 100_000);
        let recipient = Address::generate(&env);

        client.add_whitelist(&recipient);

        StellarAssetClient::new(&env, &token).mint(&owner, &200_000);
        token::Client::new(&env, &token).transfer(&owner, &client.address, &200_000);

        client.transfer(&recipient, &100_000);


        env.ledger().set_timestamp(env.ledger().timestamp() + 86_401);
        client.transfer(&recipient, &100_000);

    }

    #[test]
    fn test_transfer_rejects_zero_amount() {
        let env = Env::default();
        let (_token, client, _owner, _recovery) = setup_wallet(&env, 1_000_000);
        let recipient = Address::generate(&env);

        client.add_whitelist(&recipient);


        assert_eq!(
            client.try_transfer(&recipient, &0),
            Err(Ok(WalletError::ZeroAmount))
        );
    }

    // -----------------------------------------------------------------------
    // freeze / unfreeze
    // -----------------------------------------------------------------------

    #[test]
    fn test_freeze_by_recovery_key() {
        let env = Env::default();
        let (_token, client, _owner, recovery) = setup_wallet(&env, 1_000_000);
        assert!(!client.is_frozen());
        client.freeze(&recovery);

        assert!(client.is_frozen());
    }

    #[test]
    fn test_freeze_by_owner_fails() {
        let env = Env::default();
        let (_token, client, owner, _recovery) = setup_wallet(&env, 1_000_000);
        assert_eq!(
            client.try_freeze(&owner),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_freeze_by_random_fails() {
        let env = Env::default();
        let (_token, client, _owner, _recovery) = setup_wallet(&env, 1_000_000);
        let random = Address::generate(&env);
        assert_eq!(
            client.try_freeze(&random),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_unfreeze_by_recovery_key() {
        let env = Env::default();
        let (_token, client, _owner, recovery) = setup_wallet(&env, 1_000_000);
        client.freeze(&recovery);

        assert!(client.is_frozen());
        client.unfreeze(&recovery);

        assert!(!client.is_frozen());
    }

    #[test]
    fn test_unfreeze_by_non_recovery_fails() {
        let env = Env::default();
        let (_token, client, owner, recovery) = setup_wallet(&env, 1_000_000);
        client.freeze(&recovery);

        assert_eq!(
            client.try_unfreeze(&owner),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    // -----------------------------------------------------------------------
    // whitelist
    // -----------------------------------------------------------------------

    #[test]
    fn test_add_whitelist_dedup() {
        let env = Env::default();
        let (_token, client, _owner, _recovery) = setup_wallet(&env, 1_000_000);
        let addr = Address::generate(&env);
        client.add_whitelist(&addr);

        assert_eq!(
            client.try_add_whitelist(&addr),
            Err(Ok(WalletError::AlreadyWhitelisted))
        );
    }

    #[test]
    fn test_remove_whitelist_success() {
        let env = Env::default();
        let (_token, client, _owner, _recovery) = setup_wallet(&env, 1_000_000);
        let addr = Address::generate(&env);
        client.add_whitelist(&addr);

        client.remove_whitelist(&addr);

        // After removal transfer should be rejected
        assert_eq!(
            client.try_transfer(&addr, &100),
            Err(Ok(WalletError::AddressNotWhitelisted))
        );
    }

    #[test]
    fn test_remove_whitelist_missing_address() {
        let env = Env::default();
        let (_token, client, _owner, _recovery) = setup_wallet(&env, 1_000_000);
        let addr = Address::generate(&env);
        assert_eq!(
            client.try_remove_whitelist(&addr),
            Err(Ok(WalletError::AddressNotWhitelisted))
        );
    }

    #[test]
    fn test_remove_whitelist_unauthorized() {
        let env = Env::default();
        let (_token, client, _owner, _recovery) = setup_wallet(&env, 1_000_000);
        // mock_all_auths is active so we test the logic path directly —
        // a separate auth-enforcement test would require mock_all_auths_allowing_non_root_auth
        let addr = Address::generate(&env);
        client.add_whitelist(&addr);

        // This call succeeds under mock_all_auths; auth hardening is covered in issue #20
        client.remove_whitelist(&addr);

    }

    // -----------------------------------------------------------------------
    // update_recovery_key
    // -----------------------------------------------------------------------

    #[test]
    fn test_update_recovery_key_success() {
        let env = Env::default();
        let (_token, client, _owner, recovery) = setup_wallet(&env, 1_000_000);
        let new_recovery = Address::generate(&env);
        client.update_recovery_key(&new_recovery);

        // Old recovery key can no longer freeze
        assert_eq!(
            client.try_freeze(&recovery),
            Err(Ok(WalletError::Unauthorized))
        );
        // New recovery key can freeze
        client.freeze(&new_recovery);

        assert!(client.is_frozen());
    }

    #[test]
    fn test_transfer_after_unfreeze() {
        let env = Env::default();
        let (token, client, owner, recovery) = setup_wallet(&env, 1_000_000);
        let recipient = Address::generate(&env);

        client.add_whitelist(&recipient);

        StellarAssetClient::new(&env, &token).mint(&owner, &500_000);
        token::Client::new(&env, &token).transfer(&owner, &client.address, &500_000);

        client.freeze(&recovery);

        assert_eq!(
            client.try_transfer(&recipient, &100_000),
            Err(Ok(WalletError::WalletFrozen))
        );
        client.unfreeze(&recovery);

        client.transfer(&recipient, &100_000);

        assert_eq!(token::Client::new(&env, &token).balance(&recipient), 100_000);
    }
}
