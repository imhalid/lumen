# Lumen

Distraction-free notes, made to last

[uselumen.com](https://uselumen.com)

## Development

For local development **with GitHub repo clone/sync**, use:

```bash
npm run dev:vercel
```

Then open **http://localhost:8888**.  

Using `npm run dev` (plain Vite) does not run the `/cors-proxy` API, so selecting a repo will fail with a "Remote did not reply using the smart HTTP protocol" error.
