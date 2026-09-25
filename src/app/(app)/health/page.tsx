import type { Metadata } from "next";
import { HealthReport } from "@/components/health/health-report";
import { requireConnection } from "@/lib/server/data";

export const metadata: Metadata = { title: "Bucket health" };

export default async function HealthPage() {
  const c = await requireConnection();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <HealthReport bucket={c.bucket} />
    </div>
  );
}
