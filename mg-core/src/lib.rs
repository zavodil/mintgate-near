#![deny(warnings)]

pub mod fraction;

use fraction::Fraction;
use near_env::near_envlog;
use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    collections::{LookupMap, UnorderedMap, UnorderedSet},
    env,
    json_types::U64,
    near_bindgen,
    serde::Serialize,
    AccountId, Balance, PanicOnDefault,
};

#[global_allocator]
static ALLOC: near_sdk::wee_alloc::WeeAlloc<'_> = near_sdk::wee_alloc::WeeAlloc::INIT;

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Contract {
    collectibles: UnorderedMap<GateId, Collectible>,
    collectibles_by_creator: LookupMap<AccountId, UnorderedSet<GateId>>,
    tokens: UnorderedMap<TokenId, Token>,
    tokens_by_owner: LookupMap<AccountId, UnorderedSet<TokenId>>,
    /// Percentage fee to pay back to Mintgate when a `Token` is being sold.
    /// This field can be set up when the contract is deployed.
    mintgate_fee: Fraction,
}

/// The `GateId` type represents the identifier of each `Collectible`.
type GateId = String;

/// The `TokenId` type represents the identifier of each `Token`.
type TokenId = u64;

#[derive(BorshDeserialize, BorshSerialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Collectible {
    gate_id: GateId,
    creator_id: AccountId,
    title: String,
    description: String,
    current_supply: u64,
    gate_url: String,
    minted_tokens: Vec<TokenId>,
    royalty: Fraction,
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Token {
    token_id: TokenId,
    gate_id: GateId,
    owner_id: AccountId,
}

#[near_envlog(skip_args, only_pub)]
#[near_bindgen]
impl Contract {
    #[init]
    pub fn init(mintgate_fee: Fraction) -> Self {
        Self {
            collectibles: UnorderedMap::new(vec![b'0']),
            collectibles_by_creator: LookupMap::new(vec![b'1']),
            tokens: UnorderedMap::new(vec![b'2']),
            tokens_by_owner: LookupMap::new(vec![b'3']),
            mintgate_fee,
        }
    }

    pub fn create_collectible(
        &mut self,
        gate_id: String,
        title: String,
        description: String,
        supply: U64,
        gate_url: String,
        royalty: Fraction,
    ) {
        let creator_id = env::predecessor_account_id();

        let collectible = Collectible {
            gate_id,
            creator_id,
            title,
            description,
            current_supply: supply.0,
            gate_url,
            minted_tokens: Vec::new(),
            royalty,
        };
        self.collectibles.insert(&collectible.gate_id, &collectible);

        let mut gids = self
            .collectibles_by_creator
            .get(&collectible.creator_id)
            .unwrap_or_else(|| UnorderedSet::new(get_key_prefix(b'c', &collectible.creator_id)));
        gids.insert(&collectible.gate_id);

        self.collectibles_by_creator
            .insert(&collectible.creator_id, &gids);
    }

    pub fn claim_token(&mut self, gate_id: String) -> U64 {
        let owner_id = env::predecessor_account_id();

        let token_id = self.tokens.len();
        let token = Token {
            token_id,
            gate_id,
            owner_id,
        };
        self.tokens.insert(&token.token_id, &token);

        let mut tids = self
            .tokens_by_owner
            .get(&token.owner_id)
            .unwrap_or_else(|| UnorderedSet::new(get_key_prefix(b't', &token.owner_id)));
        tids.insert(&token.token_id);

        self.tokens_by_owner.insert(&token.owner_id, &tids);

        U64::from(token_id)
    }

    pub fn buy() -> u128 {
        let a: Balance = 0;
        a
    }
}

fn get_key_prefix(prefix: u8, key: &String) -> Vec<u8> {
    let mut key_prefix = Vec::with_capacity(33);
    key_prefix.push(prefix);
    key_prefix.extend(env::sha256(key.as_bytes()));
    key_prefix
}
