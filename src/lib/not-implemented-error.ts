/** Thrown when lifecycle HTTP paths are not implemented yet (adapter layer). */
export class NotImplementedError extends Error {
  constructor(message = "HTTP adapter not implemented yet") {
    super(message);
    this.name = "NotImplementedError";
  }
}
