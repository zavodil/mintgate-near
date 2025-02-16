import { formatNearAmount, parseNearAmount } from 'near-api-js/lib/utils/format';
import BN from 'bn.js';

import type { Account } from 'near-api-js';

import {
  MAX_GAS_ALLOWED,
  createAddTestCollectible,
  generateGateId,
  isWithinLastMs,
  formatNsToMs,
  logger,
  getShare,
  validGateIdRegEx,
} from './utils';
import { CorePanics, Panic } from '../src/mg-nft';
import { contractMetadata, MINTGATE_FEE, royalty as royaltySetting } from './initialData';

import type { NftApproveMsg, Payout } from '../src/mg-nft';
import type { AccountContract, Collectible, Token, Fraction, NftContract, MarketContract } from '../src';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Global {
      nftUsers: AccountContract<NftContract>[];
      marketUsers: AccountContract<MarketContract>[];
      nftFeeUser: Account;
      adminUser: Account;
    }
  }
}

jest.retryTimes(2);

describe('Nft contract', () => {
  const [alice, bob] = global.nftUsers;
  const [merchant, merchant2] = global.marketUsers;

  const mintgate = global.nftFeeUser;
  const admin = global.adminUser;

  const nonExistentAccountId = 'ron-1111111111111-111111';

  const addTestCollectible = createAddTestCollectible(admin);

  beforeEach(() => {
    logger.title(`${expect.getState().currentTestName}`);
  });

  describe('create_collectible', () => {
    let gateId: string;
    let title: string;
    let description: string;
    let supply: number;
    let royalty: Fraction;
    let media: string;
    let media_hash: string;
    let reference: string;
    let reference_hash: string;

    let collectible: Collectible | null;

    beforeAll(async () => {
      gateId = await generateGateId();

      title = 'Test title';
      description = 'Test description';
      supply = 65535;
      royalty = {
        num: 25,
        den: 100,
      };
      media = 'Test media';
      media_hash = 'Test media hash';
      reference = 'Test reference';
      reference_hash = 'Test reference hash';

      await addTestCollectible(alice, {
        gate_id: gateId,
        title,
        description,
        supply,
        royalty,
        media,
        media_hash,
        reference,
        reference_hash,
      });

      collectible = await alice.contract.get_collectible_by_gate_id({ gate_id: gateId });
    });

    it("makes a new collectible available through it's id", () => {
      logger.data('Created collectible', collectible);

      expect(collectible).not.toBeUndefined();
    });

    it('creates collectible with provided data', async () => {
      const providedData = {
        current_supply: supply,
        royalty,
      };

      logger.data('Data provided', providedData);

      expect(collectible).toMatchObject(providedData);
    });

    it("sets token's metadata for the created collectible", async () => {
      const providedMetadata = {
        title,
        description,
        copies: supply,
        media,
        media_hash,
        reference,
        reference_hash,
      };

      logger.data('Metadata provided', providedMetadata);

      expect(collectible!.metadata).toMatchObject(providedMetadata);
    });

    it("associates a new collectible with it's creator", async () => {
      const collectiblesOfAlice = await alice.contract.get_collectibles_by_creator({ creator_id: alice.accountId });

      const newCollectibles = collectiblesOfAlice.filter(({ gate_id }) => gate_id === gateId);

      logger.data("Creator's new collectibles", newCollectibles);

      expect(newCollectibles.length).toBe(1);
    });

    it("sets a correct creator's id", async () => {
      logger.data("Creator's id of the new collectible.", collectible!.creator_id);

      expect(collectible!.creator_id).toBe(alice.accountId);
    });

    it('sets minted tokens for a new collectible to an empty array', async () => {
      logger.data('Minted tokens of the new collectible.', collectible!.minted_tokens);

      expect(collectible!.minted_tokens).toEqual([]);
    });

    describe('errors', () => {
      it('throws if gate id already exists', async () => {
        logger.data('Attempting to create collectible with `gateId`', gateId);

        await expect(addTestCollectible(alice, { gate_id: gateId })).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.GateIdAlreadyExists],
              gate_id: gateId,
              msg: `Gate ID \`${gateId}\` already exists`,
            }),
          })
        );
      });

      it('throws if supply is zero', async () => {
        const supplyInvalid = 0;

        logger.data('Attempting to create collectible with supply', supplyInvalid);

        const gateIdNew = await generateGateId();

        await expect(
          addTestCollectible(alice, {
            gate_id: gateIdNew,
            supply: supplyInvalid,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.ZeroSupplyNotAllowed],
              gate_id: gateIdNew,
              msg: `Gate ID \`${gateIdNew}\` must have a positive supply`,
            }),
          })
        );
      });

      it("throws if supply exceeds maximum of rust's u16", async () => {
        const supplyInvalid = 65536;
        const gateIdNew = await generateGateId();

        logger.data('Attempting to create collectible with supply', supplyInvalid);

        await expect(
          addTestCollectible(alice, {
            gate_id: gateIdNew,
            supply: supplyInvalid,
          })
        ).rejects.toThrow(`invalid value: integer &#x60;${supplyInvalid}&#x60;, expected u16`);
      });

      it('throws if supply is negative number', async () => {
        const supplyInvalid = -1;
        logger.data('Attempting to create collectible with supply', supplyInvalid);

        await expect(
          addTestCollectible(alice, {
            gate_id: await generateGateId(),
            supply: supplyInvalid,
          })
        ).rejects.toThrow(`invalid value: integer &#x60;${supplyInvalid}&#x60;, expected u16`);
      });

      it('throws if royalty is less than minimum', async () => {
        const num = royaltySetting.min_royalty.num - 1;
        const { den } = royaltySetting.min_royalty;
        const gateIdNew = await generateGateId();

        logger.data('Attempting to create collectible with `royalty`', {
          num,
          den,
        });

        await expect(
          addTestCollectible(alice, {
            gate_id: gateIdNew,
            royalty: {
              num,
              den,
            },
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.RoyaltyMinThanAllowed],
              royalty: {
                num,
                den,
              },
              gate_id: gateIdNew,
              msg: `Royalty \`${num}/${den}\` of \`${gateIdNew}\` is less than min`,
            }),
          })
        );
      });

      it('throws if royalty is greater than maximum', async () => {
        const num = royaltySetting.max_royalty.num + 1;
        const { den } = royaltySetting.max_royalty;
        const gateIdNew = await generateGateId();

        logger.data('Attempting to create collectible with `royalty`', {
          num,
          den,
        });

        await expect(
          addTestCollectible(alice, {
            gate_id: gateIdNew,
            royalty: {
              num,
              den,
            },
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.RoyaltyMaxThanAllowed],
              royalty: {
                num,
                den,
              },
              gate_id: gateIdNew,
              msg: `Royalty \`${num}/${den}\` of \`${gateIdNew}\` is greater than max`,
            }),
          })
        );
      });

      it('throws if royalty has zero denominator', async () => {
        await expect(
          addTestCollectible(alice, {
            gate_id: gateId,
            royalty: {
              num: 0,
              den: 0,
            },
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: CorePanics[CorePanics.ZeroDenominatorFraction],
              msg: 'Denominator must be a positive number, but was 0',
            }),
          })
        );
      });

      it('throws if royalty is too large', async () => {
        const num = MINTGATE_FEE.den - MINTGATE_FEE.num + 1;

        await expect(
          addTestCollectible(alice, {
            gate_id: gateId,
            royalty: {
              num,
              den: MINTGATE_FEE.den,
            },
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.RoyaltyTooLarge],
              royalty: {
                num,
                den: MINTGATE_FEE.den,
              },
              mintgate_fee: MINTGATE_FEE,
              msg: `Royalty \`${num}/${MINTGATE_FEE.den}\` is too large for the given NFT fee \`${MINTGATE_FEE.num}/${MINTGATE_FEE.den}\``,
            }),
          })
        );
      });

      // test against any unwanted character by adding adding rows to the tagged template literal like this:
      // ${'PDN2L5%'}                                  | ${'contains % char'}
      it.each`
        invalidGateId                          | description
        ${'abc.'}                              | ${'contains dot char'}
        ${'abc,'}                              | ${'contains coma char'}
        ${'Ж'}                                 | ${'contains non latin chars'}
        ${'abcdefghijklmnopqrstuvwxyzABCDEFG'} | ${'is longer than 32 chars'}
        ${''}                                  | ${'is an empty string'}
      `('throws if `gate_id` is invalid ($description)', async ({ invalidGateId }) => {
        expect(invalidGateId.match(validGateIdRegEx)).toBeNull();
        await expect(addTestCollectible(alice, { gate_id: invalidGateId })).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: expect.stringContaining(
              'Failed to deserialize input from JSON.: Error("The gate ID is invalid"'
            ),
          })
        );
      });

      it('throws if title is longer than 140 symbols', async () => {
        const maxCharacters = 140;
        const gateIdNew = await generateGateId();
        const titleInvalid = 't'.repeat(maxCharacters + 1);

        await expect(
          addTestCollectible(alice, {
            gate_id: gateIdNew,
            title: titleInvalid,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.InvalidArgument],
              gate_id: gateIdNew,
              reason: `Title exceeds ${maxCharacters} chars`,
              msg: `Invalid argument for gate ID \`${gateIdNew}\`: Title exceeds ${maxCharacters} chars`,
            }),
          })
        );
      });

      it.each`
        field               | maxCharacters
        ${'description'}    | ${1024}
        ${'media'}          | ${1024}
        ${'media_hash'}     | ${1024}
        ${'reference'}      | ${1024}
        ${'reference_hash'} | ${1024}
      `('throws if $field is longer than $maxCharacters', async ({ field, maxCharacters }) => {
        const invalidString = 'a'.repeat(maxCharacters + 1);
        const gateIdNew = await generateGateId();

        try {
          await addTestCollectible(alice, {
            gate_id: gateIdNew,
            [field]: invalidString,
          });
        } catch (e) {
          logger.data('', e);
        }

        await expect(
          addTestCollectible(alice, {
            gate_id: gateIdNew,
            [field]: invalidString,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.InvalidArgument],
              gate_id: gateIdNew,
              reason: `\`${field}\` exceeds ${maxCharacters} chars`,
              msg: `Invalid argument for gate ID \`${gateIdNew}\`: \`${field}\` exceeds ${maxCharacters} chars`,
            }),
          })
        );
      });

      it('throws if called by not admin', async () => {
        const gateIdNew = await generateGateId();

        await expect(
          bob.contract.create_collectible({
            creator_id: bob.accountId,
            gate_id: gateIdNew,
            title: 'Some title',
            description: 'Some description',
            supply: 100,
            royalty,
            media: null,
            media_hash: null,
            reference: null,
            reference_hash: null,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.AdminRestrictedOperation],
              msg: 'Operation is allowed only for admin',
            }),
          })
        );
      });
    });
  });

  describe('get_collectible_by_gate_id', () => {
    it('returns collectible', async () => {
      const gateId = await generateGateId();

      await addTestCollectible(alice, { gate_id: gateId });
      const collectible = await alice.contract.get_collectible_by_gate_id({ gate_id: gateId });

      logger.data('Got collectible', collectible);

      expect(collectible).toMatchObject({ gate_id: gateId });
    });

    it('returns null if no collectible found', async () => {
      const nonExistentId = await generateGateId();
      const nonExistentCollectible = await alice.contract.get_collectible_by_gate_id({ gate_id: nonExistentId });

      expect(nonExistentCollectible).toBeNull();
    });
  });

  describe('get_collectibles_by_creator', () => {
    const numberOfCollectiblesToAdd = 5;

    let newGateIds: string[];
    let collectiblesInitial: Collectible[];
    let collectibles: Collectible[];

    beforeAll(async () => {
      const gateId = await generateGateId();

      newGateIds = Array.from(new Array(numberOfCollectiblesToAdd), (el, i) => `${gateId}${i}`);

      collectiblesInitial = await alice.contract.get_collectibles_by_creator({ creator_id: alice.accountId });
      await Promise.all(newGateIds.map((id) => addTestCollectible(alice, { gate_id: id })));
      collectibles = await alice.contract.get_collectibles_by_creator({ creator_id: alice.accountId });

      logger.data('Created collectibles for account', alice.accountId);
    });

    it('returns only collectibles by specified creator', () => {
      const uniqueCreatorIds = [...new Set(collectibles.map(({ creator_id }) => creator_id))];

      logger.data("Unique creators' ids", uniqueCreatorIds);

      expect(uniqueCreatorIds).toEqual([alice.accountId]);
    });

    it('returns all collectibles by specified creator', async () => {
      logger.data('Collectibles before', collectiblesInitial.length);
      logger.data('Collectibles added', numberOfCollectiblesToAdd);
      logger.data('Total number of collectibles', collectibles.length);

      expect(collectibles).toHaveLength(numberOfCollectiblesToAdd + collectiblesInitial.length);
      expect(
        newGateIds.every((id) => collectibles.some((collectible: Collectible) => collectible.gate_id === id))
      ).toBe(true);
    });

    it('returns empty array if no collectibles found', async () => {
      const collectiblesNonExistent = await alice.contract.get_collectibles_by_creator({
        creator_id: nonExistentAccountId,
      });

      logger.data(`Collectibles of user with id ${nonExistentAccountId}`, collectiblesNonExistent);

      expect(collectiblesNonExistent).toEqual([]);
    });
  });

  describe('delete_collectible', () => {
    it('deletes a collectible if called by creator', async () => {
      const gateId = await generateGateId();

      await addTestCollectible(alice, { gate_id: gateId });
      expect(await alice.contract.get_collectible_by_gate_id({ gate_id: gateId })).not.toBeNull();
      expect(await alice.contract.get_collectibles_by_creator({ creator_id: alice.accountId })).toContainEqual(
        expect.objectContaining({ gate_id: gateId })
      );

      await alice.contract.delete_collectible({ gate_id: gateId });
      expect(await alice.contract.get_collectible_by_gate_id({ gate_id: gateId })).toBeNull();
      expect(await alice.contract.get_collectibles_by_creator({ creator_id: alice.accountId })).not.toContainEqual(
        expect.objectContaining({ gate_id: gateId })
      );
    });

    it('deletes a collectible if called by admin', async () => {
      const gateId = await generateGateId();

      await addTestCollectible(alice, { gate_id: gateId });
      expect(await alice.contract.get_collectible_by_gate_id({ gate_id: gateId })).not.toBeNull();
      expect(await alice.contract.get_collectibles_by_creator({ creator_id: alice.accountId })).toContainEqual(
        expect.objectContaining({ gate_id: gateId })
      );
      await admin.functionCall(alice.contract.contractId, 'delete_collectible', { gate_id: gateId });
      expect(await alice.contract.get_collectible_by_gate_id({ gate_id: gateId })).toBeNull();
      expect(await alice.contract.get_collectibles_by_creator({ creator_id: alice.accountId })).not.toContainEqual(
        expect.objectContaining({ gate_id: gateId })
      );
    });

    describe('errors', () => {
      it("throws if gate id doesn't exist", async () => {
        const nonExistentGateId = 'non-existent-gate-id';

        await expect(bob.contract.delete_collectible({ gate_id: nonExistentGateId })).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.GateIdNotFound],
              gate_id: nonExistentGateId,
              msg: `Gate ID \`${nonExistentGateId}\` was not found`,
            }),
          })
        );
      });

      it('throws if collectible has tokens', async () => {
        const gateId = await generateGateId();

        await addTestCollectible(alice, { gate_id: gateId });
        await alice.contract.claim_token({ gate_id: gateId });

        await expect(alice.contract.delete_collectible({ gate_id: gateId })).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.GateIdHasTokens],
              gate_id: gateId,
              msg: `Gate ID \`${gateId}\` has already some claimed tokens`,
            }),
          })
        );
      });

      it('throws if caller is neither creator nor admin', async () => {
        const gateId = await generateGateId();

        await addTestCollectible(alice, { gate_id: gateId });

        await expect(bob.contract.delete_collectible({ gate_id: gateId })).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.NotAuthorized],
              gate_id: gateId,
              msg: `Unable to delete gate ID \`${gateId}\``,
            }),
          })
        );
      });
    });
  });

  describe('claim_token', () => {
    let gateId: string;
    const initialSupply = 1000;
    let tokenId: string;
    let initialTokensOfBob: Token[];

    beforeAll(async () => {
      gateId = await generateGateId();
      await addTestCollectible(alice, {
        gate_id: gateId,
        supply: initialSupply,
      });

      initialTokensOfBob = await bob.contract.get_tokens_by_owner({ owner_id: bob.accountId });

      tokenId = await bob.contract.claim_token({ gate_id: gateId });

      logger.data("Claimed token's id", tokenId);
      logger.data('Claimed claimer', bob.accountId);
    });

    describe('token creation', () => {
      let token: Token | null;
      let tokensOfBob: Token[];

      beforeAll(async () => {
        tokensOfBob = await alice.contract.get_tokens_by_owner({ owner_id: bob.accountId });
        token = await alice.contract.nft_token({ token_id: tokenId });

        logger.data('Claimed token', token);
      });

      it('creates only one token for an owner', async () => {
        logger.data('Tokens before', initialTokensOfBob.length);
        logger.data('Tokens added', 1);
        logger.data('Total number of tokens after', tokensOfBob.length);

        expect(tokensOfBob.length).toBe(initialTokensOfBob.length + 1);
      });

      it('sets correct owner of the token', async () => {
        logger.data('Owner of the token', token!.owner_id);

        expect(token!.owner_id).toBe(bob.accountId);
      });

      it('sets correct collectible of the token', async () => {
        logger.data("Token's gate id", token!.gate_id);

        expect(token!.gate_id).toBe(gateId);
      });

      it("sets now as time of token's creation", async () => {
        logger.data('Token created at', new Date(formatNsToMs(token!.created_at)));

        expect(isWithinLastMs(formatNsToMs(token!.created_at), 1000 * 60)).toBe(true);
      });

      it("sets time of the token's modification equal to it's creation", async () => {
        logger.data('Token modified at', new Date(formatNsToMs(token!.modified_at)));

        expect(formatNsToMs(token!.created_at)).toBe(formatNsToMs(token!.modified_at));
      });

      it('sets correct approvals for the new token', async () => {
        expect(token!.approvals).toEqual({});
        expect(token!.approval_counter).toBe('0');
      });
    });

    it('decrements current supply of the collectible', async () => {
      logger.data("Collectible's initial supply", initialSupply);

      const { current_supply } = (await alice.contract.get_collectible_by_gate_id({ gate_id: gateId }))!;

      logger.data("Collectible's current supply", current_supply);

      expect(current_supply).toBe(initialSupply - 1);
    });

    describe('errors', () => {
      it("throws if gate id doesn't exist", async () => {
        const nonExistentId = '1111A2222B33';

        logger.data('Attempting to claim a token for gate id', nonExistentId);

        await expect(alice.contract.claim_token({ gate_id: nonExistentId })).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.GateIdNotFound],
              gate_id: nonExistentId,
              msg: `Gate ID \`${nonExistentId}\` was not found`,
            }),
          })
        );
      });

      it('throws if all tokens are claimed', async () => {
        const gateIdNoSupply = await generateGateId();

        await addTestCollectible(alice, {
          gate_id: gateIdNoSupply,
          supply: 1,
        });

        logger.data('Attempting to claim 2 tokens for gate id created with supply of', 1);

        await alice.contract.claim_token({ gate_id: gateIdNoSupply });

        await expect(alice.contract.claim_token({ gate_id: gateIdNoSupply })).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.GateIdExhausted],
              gate_id: gateIdNoSupply,
              msg: `Tokens for gate id \`${gateIdNoSupply}\` have already been claimed`,
            }),
          })
        );
      });
    });
  });

  describe('burn_token', () => {
    const initialSupply = 42;

    let tokenId: string;
    let gateId: string;
    let collectible: Collectible;

    beforeAll(async () => {
      gateId = await generateGateId();
      await addTestCollectible(alice, { gate_id: gateId, supply: initialSupply });

      tokenId = await alice.contract.claim_token({ gate_id: gateId });

      await alice.contract.nft_approve(
        {
          token_id: tokenId,
          account_id: merchant.contract.contractId,
          msg: JSON.stringify({ min_price: '5' }),
        },
        MAX_GAS_ALLOWED
      );

      await alice.contract.burn_token({ token_id: tokenId }, MAX_GAS_ALLOWED);

      collectible = <Collectible>await alice.contract.get_collectible_by_gate_id({ gate_id: gateId });
    });

    it('removes token from the contract', async () => {
      expect(await alice.contract.nft_token({ token_id: tokenId })).toBeNull();
    });

    it('removes token from the collectible', async () => {
      expect(collectible.minted_tokens).not.toContain(tokenId);
    });

    it("decrements `copies` on collectible's metadata", async () => {
      expect(+collectible.metadata.copies!).toBe(+initialSupply - 1);
    });

    test('that market delists token as for sale', async () => {
      expect((await merchant.contract.get_tokens_for_sale()).every(({ token_id }) => token_id !== tokenId)).toBe(true);
      expect(
        (await merchant.contract.get_tokens_by_owner_id({ owner_id: alice.accountId })).every(
          ({ token_id }) => token_id !== tokenId
        )
      ).toBe(true);
      expect(
        (await merchant.contract.get_tokens_by_gate_id({ gate_id: gateId })).every(
          ({ token_id }) => token_id !== tokenId
        )
      ).toBe(true);
      expect(
        (await merchant.contract.get_tokens_by_creator_id({ creator_id: alice.accountId })).every(
          ({ token_id }) => token_id !== tokenId
        )
      ).toBe(true);
    });

    describe('errors', () => {
      it('throws if the initiator does not own the token', async () => {
        const tokenId2 = await alice.contract.claim_token({ gate_id: gateId });

        await expect(bob.contract.burn_token({ token_id: tokenId2 }, MAX_GAS_ALLOWED)).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.TokenIdNotOwnedBy],
              token_id: tokenId2,
              owner_id: bob.accountId,
              msg: `Token ID \`U64(${tokenId2})\` does not belong to account \`${bob.accountId}\``,
            }),
          })
        );
      });

      it('throws if for nonexistent `token_id`', async () => {
        const nonexistentTokenId = '11212112';

        await expect(bob.contract.burn_token({ token_id: nonexistentTokenId }, MAX_GAS_ALLOWED)).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.TokenIdNotFound],
              token_id: nonexistentTokenId,
              msg: `Token ID \`U64(${nonexistentTokenId})\` was not found`,
            }),
          })
        );
      });
    });
  });

  describe('get_tokens_by_owner', () => {
    const numberOfTokensToClaim = 3;

    let gateId: string;
    let tokensOfAliceBefore: Token[];
    let tokensOfAliceAfter: Token[];

    beforeAll(async () => {
      gateId = await generateGateId();

      await addTestCollectible(alice, { gate_id: gateId });

      tokensOfAliceBefore = await alice.contract.get_tokens_by_owner({ owner_id: alice.accountId });
      logger.data('Tokens before', tokensOfAliceBefore.length);

      for (let i = 0; i < numberOfTokensToClaim; i += 1) {
        await alice.contract.claim_token({ gate_id: gateId });
      }

      tokensOfAliceAfter = await alice.contract.get_tokens_by_owner({ owner_id: alice.accountId });

      logger.data('Tokens claimed', numberOfTokensToClaim);
    });

    it('returns all tokens claimed by a specific user', async () => {
      logger.data('Total number of tokens after', tokensOfAliceAfter.length);

      expect(tokensOfAliceAfter.length).toBe(tokensOfAliceBefore.length + numberOfTokensToClaim);
    });

    it('returns only tokens of a specific owner', async () => {
      const uniqueOwnerIds = [...new Set(tokensOfAliceAfter.map(({ owner_id }) => owner_id))];

      logger.data("Unique owners' ids", uniqueOwnerIds);

      expect(uniqueOwnerIds).toEqual([alice.accountId]);
    });

    it("returns an empty array if user doesn't own tokens tokens", async () => {
      const tokensOfBob = await bob.contract.get_tokens_by_owner({ owner_id: bob.accountId });

      await Promise.all(
        tokensOfBob.map(({ token_id }) =>
          bob.contract.nft_transfer({
            receiver_id: merchant.accountId,
            token_id,
            enforce_approval_id: null,
            memo: null,
          })
        )
      );

      const newTokensOfBob = await bob.contract.get_tokens_by_owner({ owner_id: bob.accountId });

      logger.data('Tokens after transferring all tokens ', newTokensOfBob);

      expect(newTokensOfBob).toHaveLength(0);
    });
  });

  describe('get_tokens_by_owner_and_gate_id', () => {
    const numberOfTokensToClaim = 3;

    let gateId1: string;
    let gateId2: string;
    let tokensOfAliceGate1: Token[];

    beforeAll(async () => {
      gateId1 = await generateGateId();
      gateId2 = await generateGateId();

      await Promise.all([
        addTestCollectible(alice, { gate_id: gateId1 }),
        addTestCollectible(alice, { gate_id: gateId2 }),
      ]);

      for (let i = 0; i < numberOfTokensToClaim; i += 1) {
        await alice.contract.claim_token({ gate_id: gateId1 });
        await alice.contract.claim_token({ gate_id: gateId2 });
      }

      logger.data('Tokens claimed for new collectible', numberOfTokensToClaim);

      tokensOfAliceGate1 = await alice.contract.get_tokens_by_owner_and_gate_id({
        gate_id: gateId1,
        owner_id: alice.accountId,
      });
    });

    it('returns all tokens of a specific user for a specific collectible', async () => {
      logger.data('Tokens returned for a specific user for a specific collectible', tokensOfAliceGate1.length);

      expect(tokensOfAliceGate1.length).toBe(numberOfTokensToClaim);
    });

    it('returns only tokens of a specific owner', async () => {
      const uniqueOwnerIds = [...new Set(tokensOfAliceGate1.map(({ owner_id }) => owner_id))];

      logger.data("Unique owners' ids", uniqueOwnerIds);

      expect(uniqueOwnerIds).toEqual([alice.accountId]);
    });

    it('returns only tokens of a specific collectible', async () => {
      const uniqueCollectibleIds = [...new Set(tokensOfAliceGate1.map(({ gate_id }) => gate_id))];

      logger.data("Unique collectibles' ids", uniqueCollectibleIds);

      expect(uniqueCollectibleIds).toEqual([gateId1]);
    });

    it('returns an empty array if the user has no tokens of the collectible', async () => {
      const gateId3 = await generateGateId();

      const tokensOfAliceGate3 = await alice.contract.get_tokens_by_owner_and_gate_id({
        gate_id: gateId3,
        owner_id: alice.accountId,
      });

      logger.data(`Tokens returned for the same user and a new collectible ${gateId3}`, tokensOfAliceGate3);

      expect(tokensOfAliceGate3).toEqual([]);
    });
  });

  describe('batch_approve', () => {
    const randomMinPrice = '50';

    let gateId: string;
    let tokensIds: string[];
    let tokens: (Token | null)[];

    beforeAll(async () => {
      const numberOfTokensToApprove = 5;

      gateId = await generateGateId();
      await addTestCollectible(alice, { gate_id: gateId });

      tokensIds = await Promise.all(
        Array.from({ length: numberOfTokensToApprove }, () => alice.contract.claim_token({ gate_id: gateId }))
      );

      await alice.contract.batch_approve(
        {
          tokens: tokensIds.map((id) => [id, randomMinPrice]),
          account_id: merchant.contract.contractId,
        },
        MAX_GAS_ALLOWED
      );

      tokens = await Promise.all(tokensIds.map((id) => bob.contract.nft_token({ token_id: id })));
    });

    it('increments approval counter of tokens', () => {
      expect(tokens.every((token) => token && token.approval_counter === '1')).toBe(true);
    });

    it("updates tokens' approvals", () => {
      expect(tokens.map((token) => token!.approvals)).toEqual(
        tokens.map(() => ({
          [merchant.contract.contractId]: {
            approval_id: '1',
            min_price: randomMinPrice,
          },
        }))
      );
    });

    test('that market lists tokens as for sale', async () => {
      expect((await merchant.contract.get_tokens_for_sale()).map(({ token_id }) => token_id)).toEqual(
        expect.arrayContaining(tokensIds)
      );
      expect(
        (await merchant.contract.get_tokens_by_owner_id({ owner_id: alice.accountId })).map(({ token_id }) => token_id)
      ).toEqual(expect.arrayContaining(tokensIds));
      expect(
        (await merchant.contract.get_tokens_by_gate_id({ gate_id: gateId })).map(({ token_id }) => token_id)
      ).toEqual(expect.arrayContaining(tokensIds));
      expect(
        (await merchant.contract.get_tokens_by_creator_id({ creator_id: alice.accountId })).map(
          ({ token_id }) => token_id
        )
      ).toEqual(expect.arrayContaining(tokensIds));
    });

    describe('with errors', () => {
      let error: Error;

      let validToken: Token | null;
      let validToken2: Token | null;

      let validTokenId: string;
      let validTokenId2: string;

      const nonexistentTokenId = '11111111111';
      let alreadyApprovedTokenId: string;
      let foreignTokenId: string;

      beforeAll(async () => {
        [alreadyApprovedTokenId] = tokensIds;
        foreignTokenId = await bob.contract.claim_token({ gate_id: gateId });

        validTokenId = await alice.contract.claim_token({ gate_id: gateId });
        validTokenId2 = await alice.contract.claim_token({ gate_id: gateId });

        try {
          await alice.contract.batch_approve(
            {
              tokens: [
                [validTokenId, randomMinPrice],
                [nonexistentTokenId, randomMinPrice],
                [alreadyApprovedTokenId, randomMinPrice],
                [foreignTokenId, randomMinPrice],
                [validTokenId2, randomMinPrice],
              ],
              account_id: merchant.contract.contractId,
            },
            MAX_GAS_ALLOWED
          );
        } catch (e) {
          error = e;
        }

        [validToken, validToken2] = await Promise.all([
          bob.contract.nft_token({ token_id: validTokenId }),
          bob.contract.nft_token({ token_id: validTokenId2 }),
        ]);
      });

      it('increments approval counter of valid tokens', () => {
        expect([validToken, validToken2].every((token) => token && token.approval_counter === '1')).toBe(true);
      });

      it("updates valid tokens' approvals", () => {
        expect([validToken, validToken2].map((token) => token!.approvals)).toEqual(
          [validToken, validToken2].map(() => ({
            [merchant.contract.contractId]: {
              approval_id: '1',
              min_price: randomMinPrice,
            },
          }))
        );
      });

      it('throws an error with rejected tokens', () => {
        expect(error).toEqual(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: 'Errors',
              panics: [
                [nonexistentTokenId, { err: Panic[Panic.TokenIdNotFound], token_id: nonexistentTokenId }],
                [alreadyApprovedTokenId, { err: Panic[Panic.OneApprovalAllowed] }],
                [
                  foreignTokenId,
                  {
                    err: Panic[Panic.TokenIdNotOwnedBy],
                    token_id: foreignTokenId,
                    owner_id: alice.accountId,
                  },
                ],
              ],
              msg: `3 error(s) detected, see \`panics\` fields for a full list of errors`,
            }),
          })
        );
      });

      test('that market lists valid tokens as for sale', async () => {
        expect((await merchant.contract.get_tokens_for_sale()).map(({ token_id }) => token_id)).toEqual(
          expect.arrayContaining([validTokenId, validTokenId2])
        );
        expect(
          (await merchant.contract.get_tokens_by_owner_id({ owner_id: alice.accountId })).map(
            ({ token_id }) => token_id
          )
        ).toEqual(expect.arrayContaining([validTokenId, validTokenId2]));
        expect(
          (await merchant.contract.get_tokens_by_gate_id({ gate_id: gateId })).map(({ token_id }) => token_id)
        ).toEqual(expect.arrayContaining([validTokenId, validTokenId2]));
        expect(
          (await merchant.contract.get_tokens_by_creator_id({ creator_id: alice.accountId })).map(
            ({ token_id }) => token_id
          )
        ).toEqual(expect.arrayContaining([validTokenId, validTokenId2]));
      });

      test('that market does not list invalid tokens as for sale', async () => {
        const tokensIdsForSale = (await merchant.contract.get_tokens_for_sale()).map(({ token_id }) => token_id);

        expect(tokensIdsForSale).not.toContain(nonexistentTokenId);
        expect(tokensIdsForSale).not.toContain(foreignTokenId);
      });

      it('throws if number of tokens to approve exceeds 10', async () => {
        const numberOfTokensToApprove = 11;

        const tokenId = await alice.contract.claim_token({ gate_id: gateId });
        const tokensIdsNew = await Promise.all(
          Array.from({ length: numberOfTokensToApprove - 1 }, () => alice.contract.claim_token({ gate_id: gateId }))
        );

        tokensIdsNew.push(tokenId);
        expect(tokensIdsNew.length).toBe(numberOfTokensToApprove);

        await expect(
          alice.contract.batch_approve(
            {
              tokens: tokensIdsNew.map((id) => [id, randomMinPrice]),
              account_id: merchant.contract.contractId,
            },
            MAX_GAS_ALLOWED
          )
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.ExceedTokensToBatchApprove],
              msg: 'At most 10 tokens are allowed to approve in batch',
            }),
          })
        );
      });
    });
  });

  describe('nft_metadata', () => {
    it("returns contract's metadata", async () => {
      logger.data('Contract created with metadata', contractMetadata);

      const metadata = await alice.contract.nft_metadata();
      logger.data('Metadata returned', metadata);

      expect(metadata).toEqual(contractMetadata);
    });
  });

  describe('nft_transfer', () => {
    let gateId: string;

    beforeAll(async () => {
      const initialSupply = 2000;

      gateId = await generateGateId();
      await addTestCollectible(alice, {
        gate_id: gateId,
        supply: initialSupply,
      });
    });

    describe('happy path', () => {
      let bobsTokenId: string;

      let initialTokensOfBob: Token[];
      let initialTokensOfAlice: Token[];
      let tokensOfAlice: Token[];
      let tokensOfBob: Token[];

      let token: Token | null;

      beforeAll(async () => {
        bobsTokenId = await bob.contract.claim_token({ gate_id: gateId });

        initialTokensOfAlice = await alice.contract.get_tokens_by_owner({ owner_id: alice.accountId });
        logger.data('New owner initially had tokens', initialTokensOfAlice.length);

        initialTokensOfBob = await bob.contract.get_tokens_by_owner({ owner_id: bob.accountId });
        logger.data('Old owner initially had tokens', initialTokensOfBob.length);

        await bob.contract.nft_transfer({
          receiver_id: alice.accountId,
          token_id: bobsTokenId,
          enforce_approval_id: null,
          memo: null,
        });

        tokensOfAlice = await alice.contract.get_tokens_by_owner({ owner_id: alice.accountId });
        tokensOfBob = await bob.contract.get_tokens_by_owner({ owner_id: bob.accountId });

        token = await bob.contract.nft_token({ token_id: bobsTokenId });

        logger.data('Token after transfer', token);
      });

      it("associates token with it's new owner", () => {
        logger.data('New owner has tokens after transfer', tokensOfAlice.length);

        expect(token).not.toBeUndefined();
        expect(initialTokensOfAlice.length).toBe(tokensOfAlice.length - 1);
      });

      it("disassociates token from it's previous owner", () => {
        logger.data('Old owner has tokens after transfer', tokensOfBob.length);

        expect(initialTokensOfBob.length).toBe(tokensOfBob.length + 1);

        const [transferredToken] = tokensOfBob.filter(({ token_id }) => token_id === bobsTokenId);

        expect(transferredToken).toBeUndefined();
      });

      it("sets token's new owner", async () => {
        logger.data("New owner's id", alice.accountId);
        logger.data("Owner's id on token after transfer", token!.owner_id);

        expect(token!.owner_id).toBe(alice.accountId);
      });

      it("updates token's modified_at property", async () => {
        logger.data('Token created at', new Date(formatNsToMs(token!.created_at)));
        logger.data('Token modified at', new Date(formatNsToMs(token!.modified_at)));

        expect(formatNsToMs(token!.modified_at)).toBeGreaterThan(formatNsToMs(token!.created_at));
      });

      it("doesn't throw if sender is approved by owner", async () => {
        const tokenId = await bob.contract.claim_token({ gate_id: gateId });
        logger.data("Token's owner is", bob.accountId);

        await bob.contract.nft_approve(
          {
            token_id: tokenId,
            account_id: merchant.contract.contractId,
            msg: JSON.stringify({
              min_price: '5',
            }),
          },
          MAX_GAS_ALLOWED
        );
        logger.data("Token's sender is approved", merchant.contract.contractId);

        await expect(
          merchant.contractAccount.functionCall(bob.contract.contractId, 'nft_transfer', {
            receiver_id: alice.accountId,
            token_id: tokenId,
            enforce_approval_id: null,
            memo: null,
          })
        ).resolves.not.toThrow();
      });

      it('clears approvals', async () => {
        const tokenId = await bob.contract.claim_token({ gate_id: gateId });
        logger.data("Token's owner is", bob.accountId);

        await bob.contract.nft_approve(
          {
            token_id: tokenId,
            account_id: merchant.contract.contractId,
            msg: JSON.stringify({
              min_price: '5',
            }),
          },
          MAX_GAS_ALLOWED
        );
        logger.data("Token's sender is approved", merchant.contract.contractId);

        let token2 = await bob.contract.nft_token({ token_id: tokenId });
        expect(token2!.approvals).not.toEqual({});

        await bob.contract.nft_transfer({
          receiver_id: alice.accountId,
          token_id: tokenId,
          enforce_approval_id: null,
          memo: null,
        });

        token2 = await bob.contract.nft_token({ token_id: tokenId });

        expect(token2!.approvals).toEqual({});
      });

      it.todo('enforce_approval_id');

      it.todo('memo');
    });

    describe('errors', () => {
      let alicesTokenId: string;
      let token: Token | null;

      beforeAll(async () => {
        alicesTokenId = await alice.contract.claim_token({ gate_id: gateId });

        token = await alice.contract.nft_token({ token_id: alicesTokenId });
      });

      it('throws for nonexistent token id', async () => {
        const nonExistentId = '11111111111111111111';

        logger.data('Attempting to transfer token with id', nonExistentId);

        await expect(
          alice.contract.nft_transfer({
            receiver_id: alice.accountId,
            token_id: nonExistentId,
            enforce_approval_id: null,
            memo: null,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.TokenIdNotFound],
              token_id: nonExistentId,
              msg: `Token ID \`U64(${nonExistentId})\` was not found`,
            }),
          })
        );
      });

      it('throws when owner and receiver are one person', async () => {
        logger.data('Alice created and claimed new token', token);

        logger.data('Attempting to transfer new token from', alice.accountId);
        logger.data('Attempting to transfer new token to', alice.accountId);

        await expect(
          alice.contract.nft_transfer({
            receiver_id: alice.accountId,
            token_id: alicesTokenId,
            enforce_approval_id: null,
            memo: null,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.ReceiverIsOwner],
              msg: 'The token owner and the receiver should be different',
            }),
          })
        );
      });

      it("throws when sender isn't owner and is not approved", async () => {
        logger.data('Attempting to transfer new token from', bob.accountId);

        await expect(
          bob.contract.nft_transfer({
            receiver_id: alice.accountId,
            token_id: alicesTokenId,
            enforce_approval_id: null,
            memo: null,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.SenderNotAuthToTransfer],
              sender_id: bob.accountId,
              msg: `Sender \`${bob.accountId}\` is not authorized to make transfer`,
            }),
          })
        );
      });
    });
  });

  describe('nft_payout', () => {
    const priceHrNear = '5';
    const priceInternalNear = parseNearAmount(priceHrNear);

    const royalty: Fraction = {
      num: 3,
      den: 10,
    };

    const mintgateShare = getShare(+priceHrNear, MINTGATE_FEE);
    const creatorShare = getShare(+priceHrNear, royalty);
    const sellerShare = +priceHrNear - mintgateShare - creatorShare;

    let gateId: string;

    beforeAll(async () => {
      gateId = await generateGateId();
      await addTestCollectible(bob, {
        gate_id: gateId,
        royalty,
      });
    });

    describe('creator and seller are different persons', () => {
      let payout: Payout;

      beforeAll(async () => {
        const tokenId = await alice.contract.claim_token({ gate_id: gateId });

        payout = await alice.contract.nft_payout({
          token_id: tokenId,
          balance: priceInternalNear!,
        });
      });

      it("correctly calculates mintgate's share", () => {
        expect(+formatNearAmount(payout[mintgate.accountId])).toBe(mintgateShare);
      });

      it("correctly calculates creator's share", () => {
        expect(+formatNearAmount(payout[bob.accountId])).toBe(creatorShare);
      });

      it("correctly calculates seller's share", () => {
        expect(+formatNearAmount(payout[alice.accountId])).toBe(sellerShare);
      });
    });

    describe('creator and seller are the same person', () => {
      let payout: Payout;

      beforeAll(async () => {
        const tokenId = await bob.contract.claim_token({ gate_id: gateId });

        payout = await bob.contract.nft_payout({
          token_id: tokenId,
          balance: priceInternalNear!,
        });
      });

      it("correctly calculates mintgate's share", () => {
        expect(+formatNearAmount(payout[mintgate.accountId])).toBe(mintgateShare);
      });

      it("correctly calculates seller's (=== creator's) share", () => {
        expect(+formatNearAmount(payout[bob.accountId])).toBe(sellerShare + creatorShare);
      });
    });

    describe('errors', () => {
      it('throws for nonexistent token_id', async () => {
        const nonExistentTokenId = '22222222222222';

        await expect(
          alice.contract.nft_payout({
            token_id: nonExistentTokenId,
            balance: parseNearAmount('5')!,
          })
        ).rejects.toThrow('TokenIdNotFound');
      });
    });
  });

  describe('nft_transfer_payout', () => {
    const priceHrNear = '5';
    const priceInternalNear = parseNearAmount(priceHrNear);

    const royalty: Fraction = {
      num: 3,
      den: 10,
    };

    const mintgateShare = parseNearAmount(`${getShare(+priceHrNear, MINTGATE_FEE)}`)!;
    const creatorShare = parseNearAmount(`${getShare(+priceHrNear, royalty)}`)!;
    const senderShare = new BN(priceInternalNear!).sub(new BN(creatorShare)).sub(new BN(mintgateShare)).toString();

    let gateId: string;
    let tokenId: string;

    const args = {
      receiver_id: merchant.accountId,
      approval_id: null,
      memo: null,
      balance: priceInternalNear,
    };

    beforeAll(async () => {
      gateId = await generateGateId();
      await addTestCollectible(alice, {
        gate_id: gateId,
        royalty,
      });
    });

    it('returns the correct payout if receiver is not creator', async () => {
      tokenId = await bob.contract.claim_token({ gate_id: gateId });

      const payoutReceived = await bob.contract.nft_transfer_payout({
        ...args,
        token_id: tokenId,
      });

      expect(payoutReceived).toEqual({
        [mintgate.accountId]: mintgateShare,
        [bob.accountId]: senderShare,
        [alice.accountId]: creatorShare,
      });
    });

    it('returns the correct payout if receiver is creator', async () => {
      tokenId = await alice.contract.claim_token({ gate_id: gateId });

      const payoutReceived = await alice.contract.nft_transfer_payout({
        ...args,
        token_id: tokenId,
      });

      expect(payoutReceived).toEqual({
        [mintgate.accountId]: mintgateShare,
        [alice.accountId]: new BN(creatorShare).add(new BN(senderShare)).toString(),
      });
    });

    describe('token transfer', () => {
      let token: Token;

      beforeAll(async () => {
        tokenId = await alice.contract.claim_token({ gate_id: gateId });

        await alice.contract.nft_transfer_payout({
          ...args,
          token_id: tokenId,
        });

        [token] = (await alice.contract.get_tokens_by_owner({ owner_id: merchant.accountId })).filter(
          ({ token_id }) => token_id === tokenId
        );
      });

      it("associates token with it's new owner", () => {
        expect(token).not.toBeUndefined();
      });

      it("disassociates token from it's previous owner", async () => {
        const [soldToken] = (await alice.contract.get_tokens_by_owner({ owner_id: alice.accountId })).filter(
          ({ token_id }) => token_id === tokenId
        );

        expect(soldToken).toBeUndefined();
      });

      it("sets token's new owner", async () => {
        expect(token.owner_id).toBe(merchant.accountId);
      });

      it("updates token's modified_at property", async () => {
        expect(formatNsToMs(token.modified_at)).toBeGreaterThan(formatNsToMs(token.created_at));
      });
    });
  });

  describe('nft_token', () => {
    it("returns a token by its' id", async () => {
      const gateId = await generateGateId();
      await addTestCollectible(alice, {
        gate_id: gateId,
      });

      const tokenId = await bob.contract.claim_token({ gate_id: gateId });
      logger.data('Claimed token with id', tokenId);

      const tokensOfBob = await bob.contract.get_tokens_by_owner({ owner_id: bob.accountId });

      const [tokenFromAllTokens] = tokensOfBob.filter(({ token_id }) => token_id === tokenId);
      logger.data('Token found using `get_tokens_by_owner`', tokenFromAllTokens);

      const tokenById = await bob.contract.nft_token({ token_id: tokenId });
      logger.data('Token found using `nft_token`', tokenById);

      expect(tokenFromAllTokens).toEqual(tokenById);
    });

    it('returns null if no token found', async () => {
      const nonExistentId = '99999';
      const nonExistentCollectible = await bob.contract.nft_token({ token_id: nonExistentId });

      expect(nonExistentCollectible).toBeNull();
    });
  });

  describe('nft_approve', () => {
    let gateId: string;
    let tokenId: string;
    let token: Token | null;

    const message: NftApproveMsg = {
      min_price: '5',
    };

    beforeAll(async () => {
      gateId = await generateGateId();
      await addTestCollectible(alice, { gate_id: gateId });

      tokenId = await bob.contract.claim_token({ gate_id: gateId });

      token = await bob.contract.nft_token({ token_id: tokenId });
      logger.data('Token before approval', token);

      await bob.contract.nft_approve(
        {
          token_id: tokenId,
          account_id: merchant.contract.contractId,
          msg: JSON.stringify(message),
        },
        MAX_GAS_ALLOWED
      );

      token = await bob.contract.nft_token({ token_id: tokenId });
      logger.data('Token after approval', token);
    });

    it('increments approval counter', () => {
      logger.data('Token approvals counter', token!.approval_counter);

      expect(token!.approval_counter).toBe('1');
    });

    it("updates token's approvals", () => {
      logger.data('Token approvals', token!.approvals);

      expect(token!.approvals[merchant.contract.contractId]).toEqual({
        approval_id: String(Object.keys(token!.approvals).length),
        min_price: message.min_price,
      });
    });

    test('that market lists the token as for sale', async () => {
      const tokensForSale = await merchant.contract.get_tokens_for_sale();

      logger.data('Tokens for sale on market contract', tokensForSale);

      expect(tokensForSale).toContainEqual(expect.objectContaining({ token_id: tokenId }));
      expect(await merchant.contract.get_tokens_by_owner_id({ owner_id: bob.accountId })).toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_gate_id({ gate_id: gateId })).toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_creator_id({ creator_id: alice.accountId })).toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
    });

    describe('errors', () => {
      it("throws if `msg` doesn't contain `min price`", async () => {
        const msg = JSON.stringify({});

        logger.data('Attempting to approve token with message', msg);

        await expect(
          alice.contract.nft_approve(
            {
              token_id: tokenId,
              account_id: merchant.contract.contractId,
              msg,
            },
            MAX_GAS_ALLOWED
          )
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.MsgFormatMinPriceMissing],
              reason: 'missing field `min_price` at line 1 column 2',
              msg: `Could not find min_price in msg: missing field \`min_price\` at line 1 column 2`,
            }),
          })
        );
      });

      it('throws if `msg` is absent', async () => {
        logger.data('Attempting to approve token without message');

        await expect(
          alice.contract.nft_approve({
            token_id: tokenId,
            account_id: merchant.contract.contractId,
            msg: null,
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.MsgFormatNotRecognized],
              msg: 'The msg argument must contain the minimum price',
            }),
          })
        );
      });

      it("throws if approver doesn't own the token", async () => {
        logger.data('Attempting to approve token, approver', alice.accountId);
        logger.data('Attempting to approve token, owner', bob.accountId);

        const tokenId2 = await bob.contract.claim_token({ gate_id: gateId });

        await expect(
          alice.contract.nft_approve(
            {
              token_id: tokenId2,
              account_id: merchant.contract.contractId,
              msg: JSON.stringify(message),
            },
            MAX_GAS_ALLOWED
          )
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.TokenIdNotOwnedBy],
              token_id: tokenId2,
              owner_id: alice.accountId,
              msg: `Token ID \`U64(${tokenId2})\` does not belong to account \`${alice.accountId}\``,
            }),
          })
        );
      });

      it('throws for already approved token ', async () => {
        const tokenId2 = await alice.contract.claim_token({ gate_id: gateId });

        await alice.contract.nft_approve(
          {
            token_id: tokenId2,
            account_id: merchant.contract.contractId,
            msg: JSON.stringify(message),
          },
          MAX_GAS_ALLOWED
        );

        const token2 = await alice.contract.nft_token({ token_id: tokenId2 });
        logger.data('Attempting to approve token with approvals:', token2!.approvals);

        await expect(
          alice.contract.nft_approve({
            token_id: tokenId2,
            account_id: merchant.contract.contractId,
            msg: JSON.stringify(message),
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.OneApprovalAllowed],
              msg: 'At most one approval is allowed per Token',
            }),
          })
        );
      });

      it('throws for nonexistent `token_id`', async () => {
        const nonExistentTokenId = '222222222222222';

        await expect(
          alice.contract.nft_approve({
            token_id: nonExistentTokenId,
            account_id: merchant.contract.contractId,
            msg: JSON.stringify(message),
          })
        ).rejects.toThrow(
          expect.objectContaining({
            type: 'GuestPanic',
            panic_msg: JSON.stringify({
              err: Panic[Panic.TokenIdNotFound],
              token_id: nonExistentTokenId,
              msg: `Token ID \`U64(${nonExistentTokenId})\` was not found`,
            }),
          })
        );
      });
    });
  });

  describe('nft_revoke', () => {
    let gateId: string;
    let tokenId: string;
    let token: Token | null;

    beforeAll(async () => {
      gateId = await generateGateId();
      await addTestCollectible(alice, { gate_id: gateId });

      tokenId = await bob.contract.claim_token({ gate_id: gateId });

      const msg: NftApproveMsg = {
        min_price: '5',
      };

      await bob.contract.nft_approve(
        {
          token_id: tokenId,
          account_id: merchant.contract.contractId,
          msg: JSON.stringify(msg),
        },
        MAX_GAS_ALLOWED
      );

      token = await bob.contract.nft_token({ token_id: tokenId });
      expect(token!.approvals[merchant.contract.contractId]).not.toBeUndefined();

      logger.data('Approvals before', token!.approvals);

      await bob.contract.nft_revoke(
        {
          token_id: tokenId,
          account_id: merchant.contract.contractId,
        },
        MAX_GAS_ALLOWED
      );
    });

    it('removes approval for specified market on token', async () => {
      token = await bob.contract.nft_token({ token_id: tokenId });
      expect(token!.approvals[merchant.contract.contractId]).toBeUndefined();

      logger.data('Approvals after', token!.approvals);
    });

    test('that market delists token as for sale', async () => {
      expect(await merchant.contract.get_tokens_for_sale()).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_owner_id({ owner_id: bob.accountId })).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_gate_id({ gate_id: gateId })).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_creator_id({ creator_id: alice.accountId })).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
    });

    it("throws if revoker doesn't own the token", async () => {
      token = await bob.contract.nft_token({ token_id: tokenId });

      logger.data('Attempting to revoke token, revoker', alice.accountId);
      logger.data('Attempting to revoke token, owner', token!.owner_id);

      await expect(
        alice.contract.nft_revoke({
          token_id: token!.token_id,
          account_id: merchant.contract.contractId,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          type: 'GuestPanic',
          panic_msg: JSON.stringify({
            err: Panic[Panic.TokenIdNotOwnedBy],
            token_id: token!.token_id,
            owner_id: alice.accountId,
            msg: `Token ID \`U64(${token!.token_id})\` does not belong to account \`${alice.accountId}\``,
          }),
        })
      );
    });

    it('throw if token is not approved for market', async () => {
      const tokenId2 = await bob.contract.claim_token({ gate_id: gateId });
      const token2 = await bob.contract.nft_token({ token_id: tokenId2 });

      logger.data("Attempting to revoke token, token's approvals", token2!.approvals);

      await expect(
        bob.contract.nft_revoke({
          token_id: tokenId2,
          account_id: merchant.contract.contractId,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          type: 'GuestPanic',
          panic_msg: JSON.stringify({
            err: Panic[Panic.RevokeApprovalFailed],
            account_id: merchant.contract.contractId,
            msg: `Could not revoke approval for \`${merchant.contract.contractId}\``,
          }),
        })
      );
    });

    it('throws for nonexistent `token_id`', async () => {
      const nonExistentId = '11111111111111111111';

      logger.data('Attempting to revoke approvals for token with id', nonExistentId);

      await expect(
        alice.contract.nft_revoke({
          token_id: nonExistentId,
          account_id: merchant.contract.contractId,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          type: 'GuestPanic',
          panic_msg: JSON.stringify({
            err: Panic[Panic.TokenIdNotFound],
            token_id: nonExistentId,
            msg: `Token ID \`U64(${nonExistentId})\` was not found`,
          }),
        })
      );
    });
  });

  describe('nft_revoke_all', () => {
    let gateId: string;
    let tokenId: string;

    beforeAll(async () => {
      gateId = await generateGateId();
      await addTestCollectible(alice, { gate_id: gateId });

      tokenId = await bob.contract.claim_token({ gate_id: gateId });

      await bob.contract.nft_approve(
        {
          token_id: tokenId,
          account_id: merchant.contract.contractId,
          msg: JSON.stringify({ min_price: '5' }),
        },
        MAX_GAS_ALLOWED
      );
      expect(await merchant.contract.get_tokens_for_sale()).toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );

      const tokenBefore = (await bob.contract.nft_token({ token_id: tokenId }))!;
      expect(tokenBefore.approvals[merchant.contract.contractId]).not.toBeUndefined();

      logger.data('Approvals before', tokenBefore.approvals);

      await bob.contract.nft_revoke_all({ token_id: tokenId }, MAX_GAS_ALLOWED);
    });

    it('removes an approval for one unspecified market', async () => {
      const tokenAfter = (await bob.contract.nft_token({ token_id: tokenId }))!;
      expect(tokenAfter.approvals).toEqual({});

      logger.data('Approvals after', tokenAfter.approvals);
    });

    test('that one market delists token as for sale', async () => {
      expect(await merchant.contract.get_tokens_for_sale()).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_owner_id({ owner_id: bob.accountId })).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_gate_id({ gate_id: gateId })).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
      expect(await merchant.contract.get_tokens_by_creator_id({ creator_id: alice.accountId })).not.toContainEqual(
        expect.objectContaining({ token_id: tokenId })
      );
    });

    // skipped for now because currently at most one approval is allowed per Token
    // multiple approvals per Token may be allowed later
    it.skip('removes approvals for all markets', async () => {
      const approvePromises: Promise<void>[] = [];

      [merchant.contract.contractId, `${merchant2.contract.contractId}-1`].forEach((contractId) => {
        const msg: NftApproveMsg = {
          min_price: '6',
        };
        approvePromises.push(
          bob.contract.nft_approve(
            {
              token_id: tokenId,
              account_id: contractId,
              msg: JSON.stringify(msg),
            },
            MAX_GAS_ALLOWED
          )
        );
      });

      await Promise.all(approvePromises);

      let token = (await bob.contract.nft_token({ token_id: tokenId }))!;
      expect(Object.keys(token.approvals).length).toBeTruthy();

      logger.data('Approvals before', token.approvals);

      await bob.contract.nft_revoke_all({ token_id: tokenId });

      token = (await bob.contract.nft_token({ token_id: tokenId }))!;
      expect(Object.keys(token.approvals)).toHaveLength(0);

      logger.data('Approvals after', token.approvals);
    });

    // skipped for now because currently at most one approval is allowed per Token
    // multiple approvals per Token may be allowed later
    test.todo('that all previously approved markets delist token as for sale');

    it("throws if revoker doesn't own the token", async () => {
      const token = (await bob.contract.nft_token({ token_id: tokenId }))!;

      logger.data('Attempting to revoke token, revoker', alice.accountId);
      logger.data('Attempting to revoke token, owner', token.owner_id);

      await expect(alice.contract.nft_revoke_all({ token_id: token.token_id })).rejects.toThrow(
        expect.objectContaining({
          type: 'GuestPanic',
          panic_msg: JSON.stringify({
            err: Panic[Panic.TokenIdNotOwnedBy],
            token_id: token.token_id,
            owner_id: alice.accountId,
            msg: `Token ID \`U64(${token.token_id})\` does not belong to account \`${alice.accountId}\``,
          }),
        })
      );
    });

    it('throws for nonexistent `token_id`', async () => {
      const nonExistentId = '11111111111111111111';

      logger.data('Attempting to revoke approvals for token with id', nonExistentId);

      await expect(
        alice.contract.nft_revoke_all({
          token_id: nonExistentId,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          type: 'GuestPanic',
          panic_msg: JSON.stringify({
            err: Panic[Panic.TokenIdNotFound],
            token_id: nonExistentId,
            msg: `Token ID \`U64(${nonExistentId})\` was not found`,
          }),
        })
      );
    });
  });

  describe('nft_total_supply', () => {
    it('returns the number of tokens minted for the contract', async () => {
      const numberOfTokensToAdd = 6;

      const gateId = await generateGateId();
      await addTestCollectible(alice, {
        gate_id: gateId,
      });

      const totalSupplyBefore = await alice.contract.nft_total_supply();
      logger.data('Total supply of tokens before', totalSupplyBefore);

      const alicesTokens: string[] = [];
      const bobsTokens: string[] = [];

      for (let i = 0; i < numberOfTokensToAdd; i += 1) {
        if (i % 2) {
          alicesTokens.push(await alice.contract.claim_token({ gate_id: gateId }));
        } else {
          bobsTokens.push(await bob.contract.claim_token({ gate_id: gateId }));
        }
      }

      await alice.contract.nft_transfer({
        receiver_id: merchant.accountId,
        token_id: alicesTokens[0],
        enforce_approval_id: null,
        memo: null,
      });

      await bob.contract.nft_approve(
        {
          token_id: bobsTokens[0],
          account_id: merchant.contract.contractId,
          msg: JSON.stringify({
            min_price: '5',
          }),
        },
        MAX_GAS_ALLOWED
      );
      await merchant2.contract.buy_token(
        {
          nft_contract_id: bob.contractAccount.accountId,
          token_id: bobsTokens[0],
        },
        MAX_GAS_ALLOWED,
        new BN('5')
      );

      const totalSupplyAfter = await alice.contract.nft_total_supply();
      logger.data('Total supply of tokens minted after', totalSupplyAfter);

      expect(+totalSupplyAfter).toBe(+totalSupplyBefore + numberOfTokensToAdd);
    });
  });

  describe('nft_tokens', () => {
    const numberOfTokensToClaim = 6;

    let gateId: string;
    let newTokensIds: string[];
    let tokensBefore: Token[];
    let tokensAfter: Token[];

    beforeAll(async () => {
      gateId = await generateGateId();

      await addTestCollectible(bob, { gate_id: gateId });

      tokensBefore = await bob.contract.nft_tokens({ from_index: null, limit: null });
      logger.data('Tokens before', tokensBefore.length);

      const firstTokenId = await bob.contract.claim_token({ gate_id: gateId });

      newTokensIds = await Promise.all(
        Array.from({ length: numberOfTokensToClaim - 1 }, async () => bob.contract.claim_token({ gate_id: gateId }))
      );
      newTokensIds.push(firstTokenId);

      tokensAfter = await bob.contract.nft_tokens({ from_index: null, limit: null });

      logger.data('Tokens claimed', numberOfTokensToClaim);
    });

    it('returns all tokens', async () => {
      logger.data('Total number of tokens after', tokensAfter.length);

      expect(tokensAfter.length).toBe(tokensBefore.length + numberOfTokensToClaim);
      expect(tokensAfter.map(({ token_id }) => token_id)).toEqual(expect.arrayContaining(newTokensIds));
    });

    describe('pagination', () => {
      const numberOfTokensOnPage = 2;

      it('returns correct tokens for the first page', async () => {
        const tokensOnPage = await bob.contract.nft_tokens({ from_index: '0', limit: numberOfTokensOnPage });

        expect(tokensOnPage).toEqual(tokensAfter.slice(0, numberOfTokensOnPage));
      });

      it('returns correct tokens for the second page', async () => {
        const tokensOnPage = await bob.contract.nft_tokens({
          from_index: String(numberOfTokensOnPage),
          limit: numberOfTokensOnPage,
        });

        expect(tokensOnPage).toEqual(tokensAfter.slice(numberOfTokensOnPage, numberOfTokensOnPage * 2));
      });

      it('returns correct tokens for the last page', async () => {
        const tokensOnPage = await bob.contract.nft_tokens({
          from_index: String(tokensAfter.length - numberOfTokensOnPage),
          limit: numberOfTokensOnPage,
        });

        expect(tokensOnPage).toEqual(tokensAfter.slice(-numberOfTokensOnPage));
      });

      it('returns an empty array if no tokens on a page', async () => {
        const tokensOnPage = await bob.contract.nft_tokens({
          from_index: String(tokensAfter.length),
          limit: numberOfTokensOnPage,
        });

        expect(tokensOnPage).toEqual([]);
      });
    });
  });

  describe('nft_supply_for_owner', () => {
    const numberOfTokensToClaim = 4;

    let gateId: string;
    let tokensAmtOwnedBefore: string;
    let tokensAmtOwnedAfter: string;

    beforeAll(async () => {
      gateId = await generateGateId();

      await addTestCollectible(bob, { gate_id: gateId });

      tokensAmtOwnedBefore = await bob.contract.nft_supply_for_owner({ account_id: alice.accountId });
      logger.data('Tokens owned by alice before', tokensAmtOwnedBefore);

      await alice.contract.claim_token({ gate_id: gateId });

      await Promise.all(
        Array.from({ length: numberOfTokensToClaim - 1 }, async () => alice.contract.claim_token({ gate_id: gateId }))
      );

      tokensAmtOwnedAfter = await bob.contract.nft_supply_for_owner({ account_id: alice.accountId });

      logger.data('Tokens claimed', numberOfTokensToClaim);
    });

    it('returns a number of token owned by an account', () => {
      logger.data('Tokens owned by alice after', tokensAmtOwnedAfter);

      expect(+tokensAmtOwnedAfter).toBe(+tokensAmtOwnedBefore + numberOfTokensToClaim);
    });

    it("returns '0' if no tokens owned by an account", async () => {
      logger.data('Getting supply for nonexistent account', nonExistentAccountId);

      expect(await bob.contract.nft_supply_for_owner({ account_id: nonExistentAccountId })).toBe('0');
    });
  });

  describe('nft_tokens_for_owner', () => {
    const numberOfTokensToClaim = 6;

    let gateId: string;
    let newTokensIds: string[];
    let tokensBefore: Token[];
    let tokensAfter: Token[];

    beforeAll(async () => {
      gateId = await generateGateId();

      await addTestCollectible(bob, { gate_id: gateId });

      tokensBefore = await alice.contract.nft_tokens_for_owner({
        account_id: bob.accountId,
        from_index: null,
        limit: null,
      });
      logger.data('Tokens before', tokensBefore.length);

      const firstTokenId = await bob.contract.claim_token({ gate_id: gateId });

      newTokensIds = await Promise.all(
        Array.from({ length: numberOfTokensToClaim - 1 }, async () => bob.contract.claim_token({ gate_id: gateId }))
      );
      newTokensIds.push(firstTokenId);

      tokensAfter = await alice.contract.nft_tokens_for_owner({
        account_id: bob.accountId,
        from_index: null,
        limit: null,
      });

      logger.data('Tokens claimed', numberOfTokensToClaim);
    });

    it('returns all tokens owned by a user', async () => {
      logger.data('Number of tokens after', tokensAfter.length);

      expect(tokensAfter.length).toBe(tokensBefore.length + numberOfTokensToClaim);
      expect(tokensAfter.map(({ token_id }) => token_id)).toEqual(expect.arrayContaining(newTokensIds));
    });

    it('returns tokens owned by only a specified user', async () => {
      expect([...new Set(tokensAfter.map(({ owner_id }) => owner_id))]).toEqual([bob.accountId]);
    });

    describe('pagination', () => {
      const numberOfTokensOnPage = 2;

      it('returns correct tokens for the first page', async () => {
        const tokensOnPage = await alice.contract.nft_tokens_for_owner({
          account_id: bob.accountId,
          from_index: '0',
          limit: numberOfTokensOnPage,
        });

        expect(tokensOnPage).toEqual(tokensAfter.slice(0, numberOfTokensOnPage));
      });

      it('returns correct tokens for the second page', async () => {
        const tokensOnPage = await alice.contract.nft_tokens_for_owner({
          account_id: bob.accountId,
          from_index: String(numberOfTokensOnPage),
          limit: numberOfTokensOnPage,
        });

        expect(tokensOnPage).toEqual(tokensAfter.slice(numberOfTokensOnPage, numberOfTokensOnPage * 2));
      });

      it('returns correct tokens for the last page', async () => {
        const tokensOnPage = await alice.contract.nft_tokens_for_owner({
          account_id: bob.accountId,
          from_index: String(tokensAfter.length - numberOfTokensOnPage),
          limit: numberOfTokensOnPage,
        });

        expect(tokensOnPage).toEqual(tokensAfter.slice(-numberOfTokensOnPage));
      });

      it('returns an empty array if no tokens on a page', async () => {
        const tokensOnPage = await alice.contract.nft_tokens_for_owner({
          account_id: bob.accountId,
          from_index: String(tokensAfter.length),
          limit: numberOfTokensOnPage,
        });

        expect(tokensOnPage).toEqual([]);
      });
    });
  });

  describe('nft_token_uri', () => {
    it('returns URI for the provided token', async () => {
      const gateId = await generateGateId();

      await addTestCollectible(bob, { gate_id: gateId });

      const tokenId = await bob.contract.claim_token({ gate_id: gateId });

      expect(await bob.contract.nft_token_uri({ token_id: tokenId })).toBe(
        `${contractMetadata.base_uri}${contractMetadata.base_uri!.endsWith('/') ? '' : '/'}${gateId}`
      );
    });

    it('returns `null` if token not found', async () => {
      expect(await bob.contract.nft_token_uri({ token_id: '1212121212' })).toBeNull();
    });
  });
});
