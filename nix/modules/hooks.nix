{ inputs, ... }:
{
  imports = [ inputs.hooks.flakeModule ];

  perSystem =
    { pkgs, ... }:
    {
      # Nix files only, run by `nix flake check`. The git hooks themselves stay
      # with simple-git-hooks (package.json): installing these too would
      # overwrite .git/hooks/pre-commit, so installationScript is not used.
      pre-commit.settings.hooks = {
        nixfmt.enable = true;
        deadnix.enable = true;
        statix.enable = true;
      };

      agentRide.devShell.buildInputs = with pkgs; [
        nixfmt
        deadnix
        statix
      ];

      formatter = pkgs.nixfmt-tree;
    };
}
