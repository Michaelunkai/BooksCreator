import {
  AutoProcessor,
  BaseStreamer,
  InterruptableStoppingCriteria,
  MultiModalityCausalLM,
} from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Janus-1.3B-ONNX";
const IMAGE_COMMAND = "/imagine ";

type WorkerMessage =
  | { type: "load" }
  | { type: "generate"; prompt: string }
  | { type: "interrupt" }
  | { type: "reset" };

type ProgressReport = {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

type WorkerNavigator = Navigator & {
  gpu?: {
    requestAdapter: (options?: {
      powerPreference?: "low-power" | "high-performance";
    }) => Promise<{ features: Set<string> } | null>;
  };
};

type JanusProcessor = Awaited<
  ReturnType<typeof AutoProcessor.from_pretrained>
> & {
  num_image_tokens: number;
};

let fp16Supported = false;
let processorPromise: Promise<JanusProcessor> | null = null;
let modelPromise: Promise<MultiModalityCausalLM> | null = null;
const stoppingCriteria = new InterruptableStoppingCriteria();

function post(status: string, data?: unknown): void {
  self.postMessage({ status, ...(data === undefined ? {} : { data }) });
}

async function checkWebGpu(): Promise<void> {
  const adapter = await (navigator as WorkerNavigator).gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No WebGPU adapter was found.");
  fp16Supported = adapter.features.has("shader-f16");
  post("capability", { fp16Supported });
}

async function getPipeline(
  progressCallback?: (report: ProgressReport) => void,
): Promise<[JanusProcessor, MultiModalityCausalLM]> {
  processorPromise ??= AutoProcessor.from_pretrained(MODEL_ID, {
    progress_callback: progressCallback,
  }) as Promise<JanusProcessor>;
  modelPromise ??= MultiModalityCausalLM.from_pretrained(MODEL_ID, {
    dtype: fp16Supported
      ? {
          prepare_inputs_embeds: "q4",
          language_model: "q4f16",
          lm_head: "fp16",
          gen_head: "fp16",
          gen_img_embeds: "fp16",
          image_decode: "fp32",
        }
      : {
          prepare_inputs_embeds: "fp32",
          language_model: "q4",
          lm_head: "fp32",
          gen_head: "fp32",
          gen_img_embeds: "fp32",
          image_decode: "fp32",
        },
    device: {
      prepare_inputs_embeds: "wasm",
      language_model: "webgpu",
      lm_head: "webgpu",
      gen_head: "webgpu",
      gen_img_embeds: "webgpu",
      image_decode: "webgpu",
    },
    progress_callback: progressCallback,
  }) as Promise<MultiModalityCausalLM>;
  const processor = processorPromise;
  const model = modelPromise;
  if (!processor || !model)
    throw new Error("The art model did not initialize.");
  try {
    return await Promise.all([processor, model]);
  } catch (error) {
    processorPromise = null;
    modelPromise = null;
    throw error;
  }
}

class ImageProgressStreamer extends BaseStreamer {
  private readonly total: number;
  private count = 0;
  private started = false;

  constructor(total: number) {
    super();
    this.total = Math.max(1, total);
  }

  put(value: bigint[][]): void {
    if (!this.started) {
      this.started = true;
      return;
    }
    this.count += value.length || 1;
    post("image-progress", {
      progress: Math.min(1, this.count / this.total),
      count: this.count,
      total: this.total,
    });
  }

  end(): void {
    // The final image is sent by generateImage.
  }
}

async function loadPipeline(): Promise<void> {
  post("loading", "Loading the free on-device art model…");
  await checkWebGpu();
  await getPipeline((report) => post("progress", report));
  post("ready");
}

async function generateImage(prompt: string): Promise<void> {
  post("generating", "Composing a story-grounded illustration…");
  const [processor, model] = await getPipeline();
  const inputs = await processor([{ role: "User", content: prompt }], {
    chat_template: "text_to_image",
  });
  const numImageTokens = processor.num_image_tokens;
  const streamer = new ImageProgressStreamer(numImageTokens);
  const outputs = await model.generate_images({
    ...inputs,
    min_new_tokens: numImageTokens,
    max_new_tokens: numImageTokens,
    do_sample: true,
    streamer,
    stopping_criteria: stoppingCriteria,
  });
  if (!outputs[0]) throw new Error("The art model returned no image.");
  const blob = await outputs[0].toBlob("image/png");
  self.postMessage({ status: "image", blob });
}

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  void (async () => {
    try {
      switch (event.data.type) {
        case "load":
          await loadPipeline();
          break;
        case "generate":
          stoppingCriteria.reset();
          await generateImage(`${IMAGE_COMMAND}${event.data.prompt}`);
          post("complete");
          break;
        case "interrupt":
          stoppingCriteria.interrupt();
          break;
        case "reset":
          stoppingCriteria.reset();
          break;
      }
    } catch (error) {
      post("error", error instanceof Error ? error.message : String(error));
    }
  })();
});
