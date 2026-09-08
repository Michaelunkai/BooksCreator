# Folio

A local book-writing studio: write in a dark, quiet literary room, turn a small idea into a draft or summary, keep a story consistent, and illustrate the manuscript.

## Open the app

Double-click **Start Folio.cmd**, then open **http://127.0.0.1:3001** in Chrome. The launcher starts a local server in the background, rebuilds automatically when the source is newer than the production bundle, restarts its tracked server when backend source is newer, and reuses an already running Folio instance otherwise. Node.js 22 or newer is required; dependencies and the production build are included in the working project.

For development: `npm install`, then `npm run dev` and open http://127.0.0.1:5173. For production: `npm run build`, then `npm start`. Run the commands from this project directory.

## Hosted deployment

[Open Folio on Vercel](https://folio-writing-studio-6r72ofj9m-michaels-projects-ef5cc570.vercel.app/)

The hosted deployment uses Vercel Authentication from the owning team, so sign in to Vercel when prompted. Its serverless filesystem is ephemeral; export a complete book backup for durable copies. The large local model cache is intentionally kept out of the hosted upload; the browser and deterministic writing fallbacks remain available.

## Write your book

- **My library → Create book** starts a blank manuscript. The House of Tides is an editable original example.
- Add, rename, reorder and organize chapters. **Chapter details** holds an outline and draft status. Format text, find a phrase, use undo/redo, and enter focus mode. Standard Ctrl+B, Ctrl+I and Ctrl+S shortcuts work.
- Open your book title to set author, genre, writing language, right-to-left direction, chapter word goal, a sample of your voice, and style preferences.
- **Story bible** holds characters, places, plot threads and world rules. These notes and chapter outlines guide generation.
- **Write** develops an idea, continues a scene, creates dialogue or plans an outline. Choose words, estimated lines, or estimated pages. **Refine** uses the selected passage. Read and edit the preview before adding it; replacement requires the original selection still to match. Insertion saves a revision first.
- **Revision history** keeps named drafts and automatically preserves the current draft before restoration.
- **Summarize** turns an idea or premise, a selected passage, a chapter, or the whole book into a one-sentence, few-sentence, paragraph, or page-length synopsis. It opens at a few sentences, preselects the passage when you have text selected, and lets you edit the result before adding it to your manuscript.

An idea-only summary needs a nonblank idea. Folio keeps that scope strict and never silently replaces an empty idea with chapter or book context. Automatic local requests are trimmed to the detected model context and reserve room for the requested output.
- **Illustrations** uses the selected passage, chapter context, prioritized character/plot/place/world notes, your art direction and a selectable medium. Folio first offers the free Janus 1.3B browser art model when WebGPU is available, then a private deterministic study when it is not. Review images, edit captions, and explicitly add them to a chapter. You can also upload or paste PNG, JPEG and WebP artwork up to 10 MB. Gallery alternatives stay out of reading exports until inserted.

## Generation without setup

Folio opens in dark mode. When no hosted provider is configured, it probes common loopback OpenAI-compatible runtimes in parallel (`http://127.0.0.1:8080/v1`, Ollama at `http://127.0.0.1:11434/v1`, LM Studio at `http://127.0.0.1:1234/v1`, and vLLM-compatible servers at `http://127.0.0.1:8000/v1`) and selects the strongest completion-capable model it can see. The launcher also starts the known local Qwen3.8 runtime automatically when its model files are already installed in Ubuntu; an absent or unavailable runtime never blocks the app. When the known runtime is available, Folio selects its strongest completion-capable model (the last verified host exposed **Qwen3.8 27B**) with hidden reasoning disabled for clean book prose. The probe is read-only, never leaves localhost and needs no API key or setup inside Folio. If every loopback runtime is stopped or absent, Folio falls through to the bundled **Qwen3.5 9B** on-device writing model through WebLLM/WebGPU. When the browser has enough headroom and a network connection, it first tries the higher-precision Qwen3.5 9B q4f32 profile; the shipped q4f16 profile is the immediate local fallback. The model assets are shipped with this project, so browser writing needs no account, provider connection, API key, or payment. The first model load can take a little time while the browser prepares the quantized model; Folio shows its progress and keeps the model in the browser cache afterward. Bundled 4B and 2B Qwen3.5 profiles are available automatically when a device cannot load 9B, so the free model chain remains local. If the loopback runtimes, WebGPU or every model profile are unavailable, the deterministic offline writing partner remains ready immediately and covers every writing and summary mode, carrying the submitted premise into its opening while varying paragraph movement. Illustrations use the free Janus 1.3B ONNX model through Transformers.js when WebGPU is available; the browser downloads and caches its weights on first use. If WebGPU or that download is unavailable, the deterministic text-grounded art study remains ready without a provider, carrying the passage, chapter context and story-bible cues into its saved prompt and choosing structural motifs from that same story material.

The complete three-profile bundle occupies about 8.53 GB on disk. Folio only initializes the first profile that fits the device, and the smaller profiles are retained as automatic local fallbacks. The multi-gigabyte local model cache is not committed to GitHub; if those files or the runtime are absent, the browser and deterministic offline routes remain available without downloading anything.

The automatic local model and browser model are used for ideas, scenes, dialogue, outlines, polishing, shortening, continuation, and summaries. The local bridge sends the selected story context to the loopback server already running on this computer; the browser route runs inside the browser. The bundled Qwen3.5 conversions follow the upstream Apache-2.0 model license; the local model manifests under `public/models/` record the asset and integrity details, while the multi-gigabyte weights stay out of version control. Janus is loaded from its public ONNX model repository at first use and follows that repository's published license. Generated text and images are always presented for review and editing.

If you want a larger hosted model, **Connection settings** is optional. It can configure:

1. **OpenAI**, with an API key and access/billing for the selected text and image models. Defaults are `gpt-6-astra` and `gpt-image-2`.
2. **OpenAI-compatible**, with a base URL ending in the service's API prefix, a text model supporting `/chat/completions`, and an image model supporting `/images/generations` with `b64_json` output. Image support is a separate capability; a text-only endpoint cannot generate art.

Enter the key in the app settings, not in a chat message. It remains in server memory until the server restarts. Alternatively, set `OPENAI_API_KEY` in the server's environment before launching Folio. The key is never returned to the browser or included in book backups. Model and endpoint preferences are saved locally. A key is bound to its provider origin; changing the host needs a key for that host.

When configured, a connected model receives the submitted idea, selected text, relevant chapter context, story notes and writing preferences. Provider billing and data policies apply. Without a configured provider, Folio uses the bundled on-device writer and the browser art model, then their deterministic offline fallbacks. Provider errors, partial outputs and cancellation are visible; existing manuscript text stays intact.

Length is a target: a line is estimated at 12 words and a page at 250 words. Actual pagination depends on the final font, page size, spacing and artwork. Distinctive prose comes from your voice sample, specific intentions, continuity notes and revision. There is no guarantee about how a reader or detector will judge authorship.

Writing requests support up to **100,000 target words** (about 400 pages). Hosted requests use sections up to 5,000 words; the automatic Qwen3.8 bridge sizes each pass from the detected model context (about 900 words on the current 8k-context runtime, capped for larger local runtimes); the bundled browser route uses conservative 4,096-token request sections and carries recent text and the story bible forward. Chapter context is bounded for each request, with separate chapter outlines and story notes. Completed sections appear in your preview as they arrive. Cancellation, errors and partial responses preserve received sections and stop further requests; failed requests never retry automatically. Long runs on a connected provider can take time and incur multiple provider charges. For detailed revision, work in passages up to 5,000 target words.

## Saving and backups

- Autosave waits approximately 600 ms after an edit, then writes `.data/workspace.json` through a temporary file and atomic rename. The previous complete library is kept in `.data/workspace.previous.json`; illustrations are files in `.data/media`.
- The header only says saved after the server confirms it. Pending changes have a browser recovery copy. Save requests are serialized. Multiple-tab conflicts never silently overwrite a newer library; **Keep my edits as a separate book** preserves both copies.
- **My library → Recoverable drafts** lets you preserve pending work from another browser session as separate books. A different window may still be editing such a draft; recovery does not delete its copy.
- Use the same hostname and port when reopening to retain access to that browser's recovery storage. A confirmed disk save is shared by both supported local URLs.
- Make regular **Complete book backup** exports and store a copy away from this project. Backup JSON embeds current and archived artwork, chapter versions, notes and voice settings. Restore it through **My library → Import backup**.
- The local workspace request limit is 25 MB excluding separately stored image bytes. A chapter supports 2 million HTML characters, 10,000 saved versions, and the library supports 100 books. A save failure is shown; export your pending work before closing.
- You can delete an unwanted saved version in **Revision history**, or delete a book in **Your book & your voice** after making a backup. Both actions require confirmation.
- Do not delete `.data`: it contains your books. If a saved library is damaged, Folio preserves it and refuses to create an empty replacement. With the server stopped, retain the damaged file separately and restore `workspace.previous.json` to `workspace.json`, or restore a known backup. Keep a copy of `.data/media` with filesystem backups.

## Export

**Word (.docx)**, **EPUB**, **standalone HTML**, **Markdown**, **plain text**, and **complete backup JSON** are available. Reading formats follow manuscript image placement. **Print / save as PDF** opens the browser print dialog; select Save as PDF and your preferred page size. Folio does not silently create a PDF without that dialog.

## Validation and implementation

`npm test` runs backend, persistence, import/export and component integration tests. `npm run build` checks TypeScript and creates the production app. Detailed verification boundaries and pending live checks are recorded in `VERIFICATION.md`.

React, Vite, TypeScript and Tiptap provide the editor; Express provides the local API; DOCX and JSZip build reading formats. Fonts are bundled locally. The generated sample artwork lives in `public/assets/tide-illustration.png`; its visual brief and primary workspace concept are in `design/` and `DESIGN.md`.

OpenAI integration references: [Responses text generation](https://developers.openai.com/api/docs/guides/text), [image generation](https://developers.openai.com/api/docs/guides/image-generation), [API key practices](https://developers.openai.com/api/docs/guides/production-best-practices#api-keys). The automatic local profile follows the [official Qwen3.8 repository](https://github.com/QwenLM/Qwen3.8) and its OpenAI-compatible local serving route. Browser writing references: the [Qwen3.5 9B q4f32 model](https://huggingface.co/mlc-ai/Qwen3.5-9B-q4f32_1-MLC) and [WebLLM](https://github.com/mlc-ai/web-llm). Free browser art references: the [Janus 1.3B ONNX model card](https://huggingface.co/onnx-community/Janus-1.3B-ONNX) and [Transformers.js WebGPU example](https://github.com/huggingface/transformers.js-examples/tree/main/janus-webgpu).

