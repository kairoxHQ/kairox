export const TIM_USER_ID = "user_tim";
export const TIM_PORTFOLIO_ID = "portfolio_tim_paper";

export async function checkDatabase(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return row?.ok === 1;
}

export async function listRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}
