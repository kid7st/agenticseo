/**
 * A failure the caller can act on. The CLI maps each kind to a documented exit
 * code so an agent can tell bad input, credential problems and provider outages
 * apart without parsing the message.
 */
export class OperationError extends Error {
  readonly kind: "input" | "credentials" | "provider";

  constructor(kind: OperationError["kind"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}
