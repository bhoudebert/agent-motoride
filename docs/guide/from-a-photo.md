# From a photo of a map

Photographed a loop on a paper map, got a screenshot of a route from a friend,
or scribbled a list of villages? Attach the picture and say what you want.

::: code-group

```bash [Terminal]
npm run ride -- --image ~/Pictures/loop.jpg "ride this on Sunday, leave at 10:00"

# at the refine> prompt:
/image ~/Pictures/loop.jpg ride this on Sunday
```

```text [Claude Code / Codex]
paste the picture (Ctrl+V in Claude Code), or drag the file in, then:
ride this on Sunday, leave at 10:00

(in Codex: codex -i ~/Pictures/loop.jpg "ride this on Sunday")
```

:::

## What happens

The planner reads the places on the picture in order, says in one line what
it read, then routes them by name with the usual tools. Every figure still
comes from map data, never from the picture. The ride is then finished like
any plan: weather, cameras, stops, and the check against your limits.

If the image is unreadable or is not a map, it says so.

## Good to know

- PNG, JPEG, WebP or GIF, 5 MB at most. The file is checked before anything is
  sent to the model.
- Only the file name is kept in the session's trace, never the picture.
- Shared a **file** rather than a picture? [Import it](/import-a-route): a GPX
  or KML gives the exact route, not names read off an image.
