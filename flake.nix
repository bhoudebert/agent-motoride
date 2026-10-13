{
  description = "agentMotoride: agentic motorcycle ride planner";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";
    import-tree.url = "github:vic/import-tree";
    hooks.url = "github:cachix/git-hooks.nix";
    hooks.inputs.nixpkgs.follows = "nixpkgs";
  };

  # Dendritic: every file under nix/modules is a flake-parts module, imported
  # automatically. Add a capability by adding a file, nothing is listed here.
  outputs =
    inputs@{ flake-parts, import-tree, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } (import-tree ./nix/modules);
}
