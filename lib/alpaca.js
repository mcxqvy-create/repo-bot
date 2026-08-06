export class AlpacaError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "AlpacaError";
    this.status = status;
    this.details = details;
  }
}

async function decodeResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class AlpacaClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async request(path, { method = "GET", body, dataApi = false, allow404 = false } = {}) {
    const base = dataApi ? this.config.dataBaseUrl : this.config.apiBaseUrl;
    const response = await this.fetch(`${base}${path}`, {
      method,
      headers: {
        "APCA-API-KEY-ID": this.config.apiKey,
        "APCA-API-SECRET-KEY": this.config.apiSecret,
        "Accept": "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2500)
    });

    const result = await decodeResponse(response);
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      throw new AlpacaError(`Alpaca request failed (${response.status})`, response.status, result);
    }
    return result;
  }

  getAccount() {
    return this.request("/v2/account");
  }

  getClock() {
    return this.request("/v2/clock");
  }

  getPosition(symbol) {
    return this.request(`/v2/positions/${encodeURIComponent(symbol)}`, { allow404: true });
  }

  getLatestQuote(symbol) {
    return this.request(`/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`, { dataApi: true });
  }

  getOrderByClientId(clientId) {
    return this.request(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientId)}&nested=true`, { allow404: true });
  }

  getOrderById(orderId) {
    return this.request(`/v2/orders/${encodeURIComponent(orderId)}?nested=true`, { allow404: true });
  }

  createOrder(order) {
    return this.request("/v2/orders", { method: "POST", body: order });
  }

  replaceOrder(orderId, changes) {
    return this.request(`/v2/orders/${encodeURIComponent(orderId)}`, { method: "PATCH", body: changes });
  }

  listOpenOrders(symbol) {
    return this.request(`/v2/orders?status=open&symbols=${encodeURIComponent(symbol)}&nested=true&limit=100&direction=desc`);
  }

  cancelOrder(orderId) {
    return this.request(`/v2/orders/${encodeURIComponent(orderId)}`, { method: "DELETE", allow404: true });
  }

  closePosition(symbol) {
    return this.request(`/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE", allow404: true });
  }
}
