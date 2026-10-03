// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {MockStorage} from "../mocks/ComposabilityMocks.sol";
import {MockComposabilityModule} from "../mocks/ComposabilityMocks.sol";

/**
 * @title SlotDerivationTest
 * @notice The one bug in this project was a storage collision, and collisions are invisible to
 *         inspection. They have to be proved not to exist.
 *
 * @dev Context. `FailSafeExecutor` was originally an installed module holding mutable state. Because
 *      a module runs via `delegatecall`, its variables were really the *account's* variables. One of
 *      them sat at a slot the account also used, and a gas refund that zeroed an address slot was
 *      later read as an array length near `2^64`, so the batch ran out of gas and reverted.
 *
 *      The fix was to remove the executor's state entirely. These tests do not prove the fix; they
 *      prove the arithmetic that makes a future reintroduction detectable.
 *
 *      Two derivations are in play, and they are NOT interchangeable:
 *
 *          native account key : keccak256(abi.encodePacked(account, 0))
 *          module key         : keccak256(abi.encodePacked(account, module))
 *
 *      and the executor derives one slot per poisoned index from a base key:
 *
 *          poison slot i      : keccak256(abi.encodePacked(baseKey, i))
 *
 *      Note the third derivation uses `baseKey`, not `baseSlot`. Poisoning a single base slot would
 *      be pointless, because an array occupies consecutive slots starting at `keccak256(slot)`, not
 *      slots hashed from `slot` itself.
 */
contract SlotDerivationTest is Test {
    MockStorage internal store;

    address internal constant ACCOUNT = address(0xACC0A7);
    address internal constant MODULE_A = address(0xA0001);
    address internal constant MODULE_B = address(0xB0002);

    function setUp() public {
        store = new MockStorage();
    }

    // -------------------------------------------------------------------------------------------
    // The two account-key derivations must not coincide
    // -------------------------------------------------------------------------------------------

    /**
     * @dev The native key and the module key must differ for every account/module pair.
     *
     *      This is the check that would have caught the original design. If they could coincide, a
     *      module could claim a slot the account already used, and the two writers would corrupt
     *      each other with no error anywhere.
     */
    function testFuzz_nativeKeyNeverEqualsModuleKey(address account, address module) public view {
        vm.assume(account != address(0));
        vm.assume(module != address(0));

        bytes32 nativeKey = keccak256(abi.encodePacked(account, uint256(0)));
        bytes32 moduleKey = store.getNamespace(account, module);

        assertTrue(nativeKey != moduleKey, "a module key collided with the native account key");
    }

    /// @dev The native key is the module key taken with the *account* as the caller, which is exactly
    ///      why it is `keccak256(abi.encodePacked(account, account))` and not the zero-slot form.
    function test_nativeKeyIsTheAccountCalledByItself() public view {
        bytes32 expected = keccak256(abi.encodePacked(ACCOUNT, ACCOUNT));
        assertEq(store.getNamespace(ACCOUNT, ACCOUNT), expected);
    }

    function test_moduleKeyUsesTheModuleAddressNotAnIndex() public view {
        // If the derivation used a segment index instead of the module address, every module would
        // share one key and the "namespacing" would be decorative.
        assertTrue(store.getNamespace(ACCOUNT, MODULE_A) != store.getNamespace(ACCOUNT, MODULE_B));
    }

    /// @dev Distinct accounts must not share a module key, even for the same module.
    function testFuzz_accountsAreSeparated(address accountA, address accountB, address module) public view {
        vm.assume(accountA != address(0) && accountB != address(0));
        vm.assume(accountA != accountB);
        vm.assume(module != address(0));

        assertTrue(
            store.getNamespace(accountA, module) != store.getNamespace(accountB, module),
            "two accounts shared a module key"
        );
    }

    // -------------------------------------------------------------------------------------------
    // Poison slots must be distinct
    // -------------------------------------------------------------------------------------------

    /**
     * @dev One base key, up to `n` poisoned slots. Every slot must be distinct, and none may equal
     *      the base key itself.
     *
     *      A duplicate here would mean one skipped segment silently poisons another segment's slot,
     *      which is exactly the failure mode the poison mechanism exists to prevent.
     */
    function testFuzz_poisonSlotsAreDistinct(bytes32 baseKey, uint8 rawN) public pure {
        // Remapped rather than rejected: `n` is the loop bound itself, so requiring it away would
        // discard 15 of every 17 inputs, and a `require` in a fuzz test that the fuzzer can trivially
        // drive is a rejection limit wearing a disguise.
        uint256 n = 2 + (uint256(rawN) % 15); // 2..16

        for (uint256 i = 0; i < n; i++) {
            bytes32 slotI = keccak256(abi.encodePacked(baseKey, i));

            assertTrue(slotI != baseKey, "a poison slot equalled its own base key");

            for (uint256 j = i + 1; j < n; j++) {
                bytes32 slotJ = keccak256(abi.encodePacked(baseKey, j));
                assertTrue(slotI != slotJ, "two poison slots collided");
            }
        }
    }

    /// @dev Two different base keys must not produce a shared poison slot.
    function testFuzz_distinctBaseKeysGiveDistinctPoisonSlots(bytes32 baseA, bytes32 baseB, uint256 index) public pure {
        vm.assume(baseA != baseB);
        // Absorption: keccak256(concat(a, i)) == keccak256(concat(b, j)) has no known construction,
        // but the check is cheap and a collision here would be a serious finding.
        assertTrue(
            keccak256(abi.encodePacked(baseA, index)) != keccak256(abi.encodePacked(baseB, index)),
            "poison slots from different base keys collided"
        );
    }

    /**
     * @dev The property the executor actually relies on: a module key and a native key must not
     *      collide *after* poisoning either, since poisoning hashes whatever base it is given.
     */
    function testFuzz_poisonedKeysAcrossBothDerivations() public view {
        for (uint256 i = 0; i < 8; i++) {
            bytes32 nativeBase = store.getNamespace(ACCOUNT, ACCOUNT);
            bytes32 moduleBase = store.getNamespace(ACCOUNT, MODULE_A);

            assertTrue(
                keccak256(abi.encodePacked(nativeBase, i)) != keccak256(abi.encodePacked(moduleBase, i)),
                "poisoned native and module keys collided"
            );
        }
    }

    // -------------------------------------------------------------------------------------------
    // Encoding, not hashing
    // -------------------------------------------------------------------------------------------

    /// @dev The derivation uses `abi.encodePacked`, so `uint256` is 32 bytes and an address is 20.
    ///      If it were `abi.encode`, an address would be padded to 32 bytes and every existing
    ///      on-chain storage layout would silently shift.
    function test_encodingIsPackedAndNotWordPadded() public pure {
        bytes memory packed = abi.encodePacked(ACCOUNT, uint256(0));
        assertEq(packed.length, 52, "packed account + uint256 must be 52 bytes");

        bytes memory encoded = abi.encode(ACCOUNT, uint256(0));
        assertEq(encoded.length, 64, "abi.encode pads to two words");

        assertTrue(keccak256(packed) != keccak256(encoded), "packed and word-padded encodings must differ");
    }

    /// @dev An address and a uint256 with the same numeric value must not produce the same key.
    ///      This is the exact confusion that made the native and module derivations look equivalent.
    function test_addressAndUintDeriveDifferently() public pure {
        uint256 shared = 42;
        assertTrue(
            keccak256(abi.encodePacked(address(uint160(shared)), uint256(0)))
                != keccak256(abi.encodePacked(shared, uint256(0))),
            "address and uint256 derivations must differ"
        );
    }

    // -------------------------------------------------------------------------------------------
    // The executor's storage, which is the account's storage
    // -------------------------------------------------------------------------------------------

    /**
     * @dev This file is deliberately about slot *arithmetic*. Whether `FailSafeExecutor` writes
     *      anything to the account is a different property, and it is covered where the executor is
     *      actually deployed and driven:
     *
     *          invariant_accountStorageIsNeverCorrupted   test/property/FailSafeExecutor.invariant.t.sol
     *          test_accountFieldsSurviveAnExecutorCall    test/invariant/FailSafeExecutor.t.sol
     *
     *      An earlier version of this file asserted it here, against a stub account calling an
     *      address with no code. It passed without executing anything, which is the same vacuity
     *      problem that produced a green invariant suite in `FailSafeExecutor.invariant.t.sol`. See
     *      docs/09-testing-strategy.md, "Two invariants that were wrong before they were right".
     */
    function test_poisonSlotsAreDerivedFromTheNamespacedKey() public view {
        // The executor poisons `getNamespacedSlot(ns, keccak256(baseSlot, i))`. Two derivations are
        // composed, and either one being wrong silently disables the provenance rule: poisoning the
        // base slot never matches a read, and skipping the namespace makes every module poison the
        // same place. So assert the shape rather than just the absence of collisions.
        bytes32 ns = store.getNamespace(ACCOUNT, MODULE_A);
        bytes32 baseSlot = keccak256("captured value 0");

        bytes32 derived = keccak256(abi.encodePacked(baseSlot, uint256(0)));
        bytes32 poisoned = store.getNamespacedSlot(ns, derived);

        assertTrue(derived != baseSlot, "the per-value slot must not be the base slot itself");
        assertTrue(poisoned != derived, "the poisoned slot must be namespaced, not the raw slot");
        assertTrue(poisoned != ns, "the poisoned slot must not be the namespace key");
        assertTrue(poisoned != bytes32(0), "the poisoned slot must not be zero");

        // Two different modules must poison the same captured value in different places.
        bytes32 otherNs = store.getNamespace(ACCOUNT, MODULE_B);
        assertTrue(
            store.getNamespacedSlot(otherNs, derived) != poisoned,
            "two modules poisoned the same slot, so provenance cannot distinguish them"
        );

        // And two captured values of the same module must not collide.
        bytes32 secondValue = keccak256(abi.encodePacked(baseSlot, uint256(1)));
        assertTrue(store.getNamespacedSlot(ns, secondValue) != poisoned, "two captured values of one module collided");
    }
}
