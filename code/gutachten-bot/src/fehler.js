export class FachlichError extends Error {
  constructor(message) {
    super(message);
    this.name = "FachlichError";
    this.code = "FACHLICH";
  }
}

export class TechnischError extends Error {
  constructor(message) {
    super(message);
    this.name = "TechnischError";
    this.code = "TECHNISCH";
  }
}

export class NichtUmgesetztError extends Error {
  constructor(schritt) {
    super(schritt);
    this.name = "NichtUmgesetztError";
    this.code = "NICHT_UMGESETZT";
  }
}

export class GesperrtError extends Error {
  constructor(nummer) {
    super(nummer);
    this.name = "GesperrtError";
    this.code = "GESPERRT";
  }
}

export function istTechnisch(error) {
  if (error?.code === "TECHNISCH") return true;
  const text = String(error?.message || error);
  return /timeout|network|ECONNRESET|EAI_AGAIN|Target closed|browser has been closed/i.test(text);
}
