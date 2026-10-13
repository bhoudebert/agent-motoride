_: {
  perSystem =
    { pkgs, ... }:
    {
      agentRide.devShell.buildInputs = with pkgs; [
        git
        gh
        jq
        sqlite
      ];
    };
}
