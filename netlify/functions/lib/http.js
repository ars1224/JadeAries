function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function methodNotAllowed(allowed) {
  return json(405, { error: "Method not allowed." }, { Allow: allowed });
}

module.exports = { json, methodNotAllowed };
