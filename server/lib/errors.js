export class HttpError extends Error {
  constructor(status, error, message = error, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function postgresErrorResponse(err) {
  if (!err || typeof err !== "object") return null;
  if (err.code === "53100") {
    return { status: 507, body: { error: "database_storage_full", message: "Database storage capacity has been reached." } };
  }
  if (err.code === "23505") {
    const constraint = String(err.constraint || "");
    if (constraint.includes("email")) return { status: 409, body: { error: "email_taken" } };
    if (constraint.includes("username")) return { status: 409, body: { error: "username_taken" } };
    return { status: 409, body: { error: "duplicate_record", message: "This record already exists." } };
  }
  if (err.code === "23503") {
    return { status: 409, body: { error: "foreign_key_conflict", message: "A related record is missing or still in use." } };
  }
  if (err.code === "23514") {
    return { status: 400, body: { error: "constraint_violation", message: "The supplied data violates a database constraint." } };
  }
  return null;
}
