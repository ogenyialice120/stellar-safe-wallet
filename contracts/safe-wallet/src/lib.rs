#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
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
    Unauthorized = 1,
    DailyCapExceeded = 2,
    AddressNotWhitelisted = 3,
    WalletFrozen = 4,
    ZeroAmount = 5,
    NotInitialised = 6,
    AlreadyInitialized = 7,
    AlreadyWhitelisted = 8,
    WhitelistFull = 9,
    // New variants — added at the END to preserve existing numeric codes.
    RecoveryKeyIsOwner = 10,
    InvalidDailyCap = 11,
    Overflow = 12,
}

// Maximum number of whitelisted addresses.
const WHITELIST_MAX: u32 = 50;

// TTL constants (in ledgers). At ~5 s/ledger:
//   TTL_MIN ≈ 30 days,  TTL_MAX ≈ 60 days.
const TTL_MIN: u32 = 518_400;
const TTL_MAX: u32 = 1_036_800;

// Daily window length in seconds.
const DAY_IN_SECONDS: u64 = 86_400;

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
    ///                    Must be positive (> 0).
    /// - `recovery_key` — Address that can freeze and unfreeze the wallet.
    ///                    Must differ from `owner`.
    /// - `token`        — Token contract address used for transfers.
    ///
    /// # Errors
    /// - `AlreadyInitialized` — wallet has already been set up.
    /// - `RecoveryKeyIsOwner` — `recovery_key` is the same address as `owner`.
    /// - `InvalidDailyCap`    — `daily_cap` is zero or negative.
    ///
    /// **BREAKING** (vs. original): `initialize` now rejects `daily_cap <= 0`
    /// (previously stored zero without error) and rejects `owner == recovery_key`.
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

        // Separation-of-duties guard: recovery key must differ from owner.
        if recovery_key == owner {
            return Err(WalletError::RecoveryKeyIsOwner);
        }

        // Daily cap must be positive.
        if daily_cap <= 0 {
            return Err(WalletError::InvalidDailyCap);
        }

        owner.require_auth();

        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::DailyCap, &daily_cap);
        env.storage()
            .instance()
            .set(&DataKey::RecoveryKey, &recovery_key);
        env.storage().instance().set(&DataKey::TokenAddress, &token);
        env.storage().instance().set(&DataKey::Frozen, &false);
        env.storage().instance().set(&DataKey::SpentToday, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::LastResetTimestamp, &env.ledger().timestamp());

        Self::bump_ttl(&env);

        env.events().publish(
            (symbol_short!("init"), symbol_short!("wallet")),
            (owner, daily_cap, recovery_key),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Whitelist management
    // -----------------------------------------------------------------------

    /// Add an address to the transfer whitelist. Owner only.
    ///
    /// # Parameters
    /// - `address` — Address to add.
    ///
    /// # Errors
    /// - `NotInitialised`     — wallet has not been initialised.
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

        list.push_back(address.clone());
        env.storage().instance().set(&DataKey::Whitelist, &list);

        Self::bump_ttl(&env);

        env.events()
            .publish((symbol_short!("wl"), symbol_short!("add")), address);

        Ok(())
    }

    /// Remove an address from the transfer whitelist. Owner only.
    ///
    /// # Parameters
    /// - `address` — Address to remove.
    ///
    /// # Errors
    /// - `NotInitialised`        — wallet has not been initialised.
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

        Self::bump_ttl(&env);

        env.events()
            .publish((symbol_short!("wl"), symbol_short!("rm")), address);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Transfers
    // -----------------------------------------------------------------------

    /// Transfer `amount` of tokens to `to`, enforcing all wallet policies.
    ///
    /// 1. Only the owner may call.
    /// 2. `amount` must be positive.
    /// 3. Rejected if the wallet is frozen.
    /// 4. Rejected if `to` is not whitelisted.
    /// 5. Resets the daily spend counter when the 24 h window has elapsed.
    /// 6. Rejected if the transfer would exceed the daily cap.
    ///
    /// Uses check-effects-interactions ordering: storage is updated before
    /// calling the external token contract.
    ///
    /// # Errors
    /// - `NotInitialised`        — wallet has not been initialised.
    /// - `Unauthorized`          — caller is not the owner.
    /// - `ZeroAmount`            — `amount` is zero or negative.
    /// - `WalletFrozen`          — wallet is currently frozen.
    /// - `AddressNotWhitelisted` — recipient is not on the whitelist.
    /// - `DailyCapExceeded`      — transfer would exceed the daily cap.
    /// - `Overflow`              — `spent_today + amount` would overflow `i128`.
    pub fn transfer(env: Env, to: Address, amount: i128) -> Result<(), WalletError> {
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

        if now >= last_reset + DAY_IN_SECONDS {
            spent_today = 0;
            env.storage()
                .instance()
                .set(&DataKey::LastResetTimestamp, &now);
        }

        // Use checked_add to guard against i128 overflow.
        let new_total = spent_today
            .checked_add(amount)
            .ok_or(WalletError::Overflow)?;

        if new_total > daily_cap {
            return Err(WalletError::DailyCapExceeded);
        }

        // CEI: update state BEFORE calling the external contract.
        env.storage()
            .instance()
            .set(&DataKey::SpentToday, &new_total);

        Self::bump_ttl(&env);

        env.events().publish(
            (symbol_short!("transfer"), symbol_short!("out")),
            (to.clone(), amount),
        );

        // External call last.
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .ok_or(WalletError::NotInitialised)?;
        token::Client::new(&env, &token_address).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Freeze / Unfreeze
    // -----------------------------------------------------------------------

    /// Freeze the wallet — halts all transfers. Recovery key only.
    ///
    /// # Parameters
    /// - `caller` — Must be the recovery key address (and must sign).
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    /// - `Unauthorized`   — `caller` is not the recovery key.
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

        Self::bump_ttl(&env);

        env.events()
            .publish((symbol_short!("freeze"), symbol_short!("ok")), caller);

        Ok(())
    }

    /// Unfreeze the wallet — resumes transfers. Recovery key only.
    ///
    /// # Parameters
    /// - `caller` — Must be the recovery key address (and must sign).
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    /// - `Unauthorized`   — `caller` is not the recovery key.
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

        Self::bump_ttl(&env);

        env.events()
            .publish((symbol_short!("unfreeze"), symbol_short!("ok")), caller);

        Ok(())
    }

    /// Returns `true` if the wallet is currently frozen.
    pub fn is_frozen(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Frozen)
            .unwrap_or(false)
    }

    // -----------------------------------------------------------------------
    // Recovery key rotation
    // -----------------------------------------------------------------------

    /// Rotate the recovery key. Requires both the owner and the current
    /// recovery key to sign.
    ///
    /// # Parameters
    /// - `new_key` — New recovery key address. Must differ from the owner.
    ///
    /// # Errors
    /// - `NotInitialised`     — wallet has not been initialised.
    /// - `Unauthorized`       — owner did not sign, or `new_key` equals the owner.
    /// - `RecoveryKeyIsOwner` — `new_key` is the same address as the owner.
    pub fn update_recovery_key(env: Env, new_key: Address) -> Result<(), WalletError> {
        // Owner must sign.
        let owner = Self::require_owner(&env)?;

        // Current recovery key must also authorise the rotation.
        let current_recovery: Address = env
            .storage()
            .instance()
            .get(&DataKey::RecoveryKey)
            .ok_or(WalletError::NotInitialised)?;
        current_recovery.require_auth();

        // Prevent setting the owner as the new recovery key.
        if new_key == owner {
            return Err(WalletError::RecoveryKeyIsOwner);
        }

        env.storage()
            .instance()
            .set(&DataKey::RecoveryKey, &new_key);

        Self::bump_ttl(&env);

        env.events()
            .publish((symbol_short!("key"), symbol_short!("rotate")), new_key);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read-only getters
    // -----------------------------------------------------------------------

    /// Returns the owner address.
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    pub fn get_owner(env: Env) -> Result<Address, WalletError> {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(WalletError::NotInitialised)
    }

    /// Returns the daily cap (in stroops).
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    pub fn get_daily_cap(env: Env) -> Result<i128, WalletError> {
        env.storage()
            .instance()
            .get(&DataKey::DailyCap)
            .ok_or(WalletError::NotInitialised)
    }

    /// Returns the amount spent in the current daily window (in stroops).
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    pub fn get_spent_today(env: Env) -> Result<i128, WalletError> {
        // Return NotInitialised if the wallet has never been set up.
        if !env.storage().instance().has(&DataKey::Owner) {
            return Err(WalletError::NotInitialised);
        }
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::SpentToday)
            .unwrap_or(0_i128))
    }

    /// Returns the current whitelist.
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    pub fn get_whitelist(env: Env) -> Result<Vec<Address>, WalletError> {
        if !env.storage().instance().has(&DataKey::Owner) {
            return Err(WalletError::NotInitialised);
        }
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::Whitelist)
            .unwrap_or_else(|| Vec::new(&env)))
    }

    /// Returns the recovery key address.
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    pub fn get_recovery_key(env: Env) -> Result<Address, WalletError> {
        env.storage()
            .instance()
            .get(&DataKey::RecoveryKey)
            .ok_or(WalletError::NotInitialised)
    }

    /// Returns the token contract address.
    ///
    /// # Errors
    /// - `NotInitialised` — wallet has not been initialised.
    pub fn get_token(env: Env) -> Result<Address, WalletError> {
        env.storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .ok_or(WalletError::NotInitialised)
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /// Extend instance storage TTL so the wallet does not expire from inactivity.
    fn bump_ttl(env: &Env) {
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);
    }

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
mod test;
