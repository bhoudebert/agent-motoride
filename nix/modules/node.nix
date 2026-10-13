_: {
  perSystem =
    { pkgs, ... }:
    {
      # Same major as .nvmrc and package.json "engines" (runs .ts natively).
      agentRide.devShell.buildInputs = [ pkgs.nodejs_24 ];
    };
}
