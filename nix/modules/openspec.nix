_: {
  perSystem =
    { pkgs, ... }:
    {
      # The spec tool (openspec/): `openspec validate --all`, as CI runs it
      # with the same locked nixpkgs (.github/workflows/specs.yml, ADR 0044).
      agentRide.devShell.buildInputs = [ pkgs.openspec ];
    };
}
