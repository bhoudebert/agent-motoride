_: {
  perSystem =
    { pkgs, lib, ... }:
    let
      # Run an npm script from the repository root, with the pinned Node.
      npmApp =
        name: script: description:
        let
          drv = pkgs.writeShellApplication {
            inherit name;
            runtimeInputs = [ pkgs.nodejs_24 ];
            text = ''
              cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
              [ -d node_modules ] || npm ci
              exec npm run --silent ${script} -- "$@"
            '';
          };
        in
        {
          type = "app";
          program = lib.getExe drv;
          meta.description = description;
        };
    in
    {
      # nix run .#eval                          offline replay of every recorded case, free
      # nix run .#eval -- --record --budget 3   live and billed, as `npm run eval`
      apps = {
        quality = npmApp "quality" "quality" "Typecheck, lint, format check, tests with coverage";
        eval = npmApp "eval" "eval" "Replay the recorded eval cases offline (--record is live and billed)";
        admin = npmApp "admin" "admin" "Riders of a multi-user instance: add, list, remove, suspend, token, backup";
        smoke = npmApp "smoke" "smoke" "Live map and weather tools, no model";
        mcp-smoke = npmApp "mcp-smoke" "mcp:smoke" "MCP server over stdio, no model";
      };
    };
}
