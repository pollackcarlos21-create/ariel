export interface ModelRequest {
  readonly userText: string;
  readonly systemText?: string;
}

export interface ModelError {
  readonly kind: "invalid-request" | "provider-failure";
  readonly message: string;
}

export type ModelResult =
  | {
      readonly status: "completed";
      readonly text: string;
    }
  | {
      readonly status: "failed";
      readonly error: ModelError;
    };

export interface ModelPort {
  generateText(request: ModelRequest): Promise<ModelResult>;
}

export async function requestModelText(
  request: ModelRequest,
  modelPort: ModelPort,
): Promise<ModelResult> {
  if (request.userText.trim().length === 0) {
    return {
      status: "failed",
      error: {
        kind: "invalid-request",
        message: "userText must not be empty.",
      },
    };
  }

  return modelPort.generateText(request);
}
