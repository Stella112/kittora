// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal Aave V3 Pool surface used by PocketVault (addresses come from @bgd-labs/aave-address-book in scripts).
interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @dev Hooks GroupKitty exposes to PocketVault.
interface IGroupKittyHooks {
    function contributeFor(uint256 groupId, address member, uint256 amount) external;
    function receiveForfeit(uint256 groupId, uint256 amount) external;
    function isMember(uint256 groupId, address account) external view returns (bool);
}

/// @dev Hook PocketVault exposes to GroupKitty (Share-Out roll-over).
interface IPocketVaultHooks {
    function depositFor(address owner, uint256 pocketId, uint256 amount) external;
}
