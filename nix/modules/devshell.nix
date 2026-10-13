{ flake-parts-lib, ... }:
{
  options.perSystem = flake-parts-lib.mkPerSystemOption (
    { lib, ... }:
    {
      options.agentRide.devShell.buildInputs = lib.mkOption {
        type = lib.types.listOf lib.types.package;
        default = [ ];
        description = "Packages contributed to the default devShell from every module.";
      };
    }
  );

  config.perSystem =
    { pkgs, config, ... }:
    {
      devShells.default = pkgs.mkShell {
        name = "agent-motoride-shell";
        packages = config.agentRide.devShell.buildInputs;

        shellHook = ''
          if [ ! -d node_modules ]; then
            echo "node_modules missing: run 'npm ci' (also installs the git hooks)"
          fi
        '';
      };
    };
}
