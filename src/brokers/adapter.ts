import type { AssetClass, OrderSide } from "../shared/types.ts";

export interface PaperOrderRequest {
  portfolioId: string;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  quantity: number;
  limitPriceUsd?: number;
  explanation: string;
}

export interface PaperOrderResult {
  orderId: string;
  status: "accepted" | "rejected";
  paperOnly: true;
  explanation: string;
}

export interface BrokerAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly supportsLiveTrading: false;
  readonly paperOnly: true;
  placePaperOrder(order: PaperOrderRequest): Promise<PaperOrderResult>;
}

export class DisabledBrokerAdapter implements BrokerAdapter {
  readonly id = "disabled";
  readonly displayName = "Disabled broker adapter";
  readonly supportsLiveTrading = false;
  readonly paperOnly = true;

  async placePaperOrder(): Promise<PaperOrderResult> {
    throw new Error("Order execution is disabled for this milestone.");
  }
}
