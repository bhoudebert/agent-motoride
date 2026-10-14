_: {
  perSystem =
    { pkgs, lib, ... }:
    let
      # Plan the same request once per local model through Ollama and leave the
      # runs in a scratch database, with one log per run. The model server is
      # the machine's own `ollama` (found on PATH, not packaged here).
      bench = pkgs.writeShellApplication {
        name = "bench";
        runtimeInputs = [
          pkgs.nodejs_24
          pkgs.curl
          pkgs.jq
          pkgs.coreutils
          pkgs.gawk
          pkgs.gnugrep
          pkgs.git
        ];
        text = ''
          cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
          [ -d node_modules ] || npm ci

          host=''${BENCH_OLLAMA_URL:-http://localhost:11434}
          min_ctx=''${BENCH_MIN_CTX:-32768}
          runs=''${BENCH_RUNS:-1}
          request=''${BENCH_REQUEST:-"Roadtrip moto this Saturday, no rain, <250km - less than 3h, ideally 2h30, winding roads, avoid motorways, avoid 30 km/h roads, limit 50 km/h towns as much as possible, most of the time riding over 70 km/h."}

          models=("$@")
          if [ ''${#models[@]} -eq 0 ]; then
            models=(gemma4:12b gemma4:26b gpt-oss:20b qwen3:14b)
          fi

          # Settings that make a run comparable, and keep it off the billed key.
          unset ANTHROPIC_AUTH_TOKEN
          export ANTHROPIC_BASE_URL="$host"
          export ANTHROPIC_API_KEY=ollama
          export RIDE_DB=''${BENCH_DB:-data/bench-local.db}
          export RIDE_SCOUTS=''${BENCH_SCOUTS:-0}
          export RIDE_EFFORT=''${BENCH_EFFORT:-medium}

          if ! curl -fsS "$host/api/version" >/dev/null; then
            echo "Ollama does not answer at $host. Start it, then run again." >&2
            exit 1
          fi
          if ! command -v ollama >/dev/null; then
            echo "The ollama command is not on PATH (needed to pull and unload models)." >&2
            exit 1
          fi

          logdir="data/bench-logs/$(date +%Y%m%d-%H%M%S)"
          mkdir -p "$logdir"
          echo "bench: models ''${models[*]} | runs $runs | scouts $RIDE_SCOUTS | db $RIDE_DB | logs $logdir"

          problems=()
          for m in "''${models[@]}"; do
            echo
            echo "=== $m"
            listed=$(ollama list | awk 'NR>1 {print $1}')
            if ! grep -qx "$m" <<<"$listed"; then
              echo "pulling $m"
              ollama pull "$m" || { problems+=("$m: pull failed"); continue; }
            fi

            # Load the model, then read the context the server really gave it:
            # a short context makes the run fail for the wrong reason.
            if ! curl -fsS "$host/api/generate" \
              -d "$(jq -n --arg m "$m" '{model: $m, prompt: "ok", stream: false, options: {num_predict: 1}}')" \
              >/dev/null; then
              problems+=("$m: could not load")
              continue
            fi
            ctx=$(curl -fsS "$host/api/ps" |
              jq -r --arg m "$m" '[.models[] | select(.name == $m or .model == $m) | .context_length // 0] | first // 0')
            echo "context $ctx"
            if [ "$ctx" -gt 0 ] && [ "$ctx" -lt "$min_ctx" ]; then
              echo "Context is $ctx, below $min_ctx: skipped (server: OLLAMA_CONTEXT_LENGTH=65536; some models cap lower)." >&2
              problems+=("$m: context $ctx")
              continue
            fi

            tag=$(tr ':/' '--' <<<"$m")
            for i in $(seq 1 "$runs"); do
              npm run --silent rides -- clear-cache >/dev/null
              echo "--- $m run $i"
              RIDE_MODEL="$m" RIDE_SCOUT_MODEL="$m" \
                npm run --silent ride -- --once "$request" 2>&1 | tee "$logdir/$tag-$i.log" || true
            done

            curl -fsS "$host/api/ps" |
              jq -c --arg m "$m" '.models[] | select(.name == $m or .model == $m) | {name, size, size_vram, context_length}' \
              >"$logdir/$tag-memory.json" || true
            ollama stop "$m" || true
          done

          echo
          npm run --silent rides -- runs | tee "$logdir/runs.txt"
          npm run --silent rides -- runs --csv >"$logdir/runs.csv"
          echo
          echo "logs: $logdir (runs.txt, runs.csv, one .log and -memory.json per model)"
          if [ ''${#problems[@]} -gt 0 ]; then
            printf 'problem: %s\n' "''${problems[@]}"
          fi
        '';
      };
    in
    {
      # nix run .#bench                       gemma4:12b, gemma4:26b, gpt-oss:20b, qwen3:14b
      # nix run .#bench -- gemma4:26b         only these models
      # BENCH_SCOUTS=1 BENCH_RUNS=3 nix run .#bench -- gemma4:12b
      apps.bench = {
        type = "app";
        program = lib.getExe bench;
        meta.description = "Plan one request on local Ollama models and compare the runs (free, no API key)";
      };
    };
}
