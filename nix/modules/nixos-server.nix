# A NixOS module that runs agentMotoride for several riders (docs/guide/self-hosting.md, ADR 0027):
#
#   inputs.agent-motoride.url = "github:bhoudebert/agent-motoride";
#   # in the system configuration:
#   imports = [ inputs.agent-motoride.nixosModules.ride-server ];
#   services.agent-motoride = { enable = true; domain = "rides.example.org"; };
#
# It runs the published container image, puts Caddy in front for HTTPS, installs an `agent-motoride-admin` command
# (add, list, remove, suspend, token, backup) and takes a backup every night.
_: {
  flake.nixosModules.ride-server =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.agent-motoride;
      backend = config.virtualisation.oci-containers.backend;
      name = "agent-motoride";
      admin = pkgs.writeShellScriptBin "agent-motoride-admin" ''
        exec ${backend} exec -i ${name} node src/admin.ts "$@"
      '';
      # The nightly backup: a consistent copy of every library into the data folder, the last `keep` kept.
      backup = pkgs.writeShellScript "agent-motoride-backup" ''
        set -eu
        ${backend} exec ${name} node src/admin.ts backup
        cd ${cfg.dataDir}/backups
        ls -1d */ 2>/dev/null | sort | head -n -${toString cfg.backup.keep} | xargs -r rm -rf --
      '';
    in
    {
      options.services.agent-motoride = {
        enable = lib.mkEnableOption "agentMotoride for several riders (MCP over HTTPS, one library per rider)";

        image = lib.mkOption {
          type = lib.types.str;
          default = "ghcr.io/bhoudebert/agent-motoride:latest";
          description = "The container image. Pin a version tag to choose when updates happen.";
        };

        domain = lib.mkOption {
          type = lib.types.str;
          example = "rides.example.org";
          description = "The domain that points at this machine; Caddy gets its certificate. Riders connect to https://<domain>/mcp.";
        };

        port = lib.mkOption {
          type = lib.types.port;
          default = 8788;
          description = "The local port the container listens on (bound to 127.0.0.1; only Caddy reaches it).";
        };

        dataDir = lib.mkOption {
          type = lib.types.path;
          default = "/var/lib/agent-motoride";
          description = "Where the registry and every rider's library live. Back this up, or use the nightly backup.";
        };

        caddy.enable = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Run Caddy in front for HTTPS, and open ports 80 and 443. Turn off to bring your own proxy.";
        };

        backup = {
          enable = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "A consistent copy of the registry and every library each night, into <dataDir>/backups.";
          };
          keep = lib.mkOption {
            type = lib.types.ints.positive;
            default = 14;
            description = "How many nightly backups to keep.";
          };
        };
      };

      config = lib.mkIf cfg.enable {
        virtualisation.oci-containers.containers.${name} = {
          image = cfg.image;
          autoStart = true;
          # Loopback only: Caddy, or the proxy you bring, is the way in.
          ports = [ "127.0.0.1:${toString cfg.port}:8788" ];
          volumes = [ "${cfg.dataDir}:/data" ];
          environment.RIDE_SERVER_URL = "https://${cfg.domain}";
        };

        # The image runs as the `node` user, uid 1000.
        systemd.tmpfiles.rules = [ "d ${cfg.dataDir} 0750 1000 1000 -" ];

        environment.systemPackages = [ admin ];

        services.caddy = lib.mkIf cfg.caddy.enable {
          enable = true;
          virtualHosts.${cfg.domain}.extraConfig = ''
            # Only the tools, the live ride relay and its page, and the health check are exposed;
            # the administration stays inside the container.
            @exposed path /mcp /health /enrol /follow.js /follow/* /share/*
            handle @exposed {
              reverse_proxy 127.0.0.1:${toString cfg.port}
            }
            handle {
              respond "Not found" 404
            }
          '';
        };
        networking.firewall.allowedTCPPorts = lib.mkIf cfg.caddy.enable [
          80
          443
        ];

        systemd.services.agent-motoride-backup = lib.mkIf cfg.backup.enable {
          description = "Back up the agentMotoride libraries";
          after = [ "${backend}-${name}.service" ];
          requires = [ "${backend}-${name}.service" ];
          serviceConfig = {
            Type = "oneshot";
            ExecStart = backup;
          };
        };
        systemd.timers.agent-motoride-backup = lib.mkIf cfg.backup.enable {
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnCalendar = "*-*-* 03:30:00";
            Persistent = true;
          };
        };
      };
    };
}
