import type { Metadata } from "next";
import Image from "next/image";
import { regionName } from "@/components/setup/regions";
import { SetupForm } from "@/components/setup/setup-form";
import { BRAND } from "@/lib/brand";
import { getConnection } from "@/lib/server/session";
import { isMockMode } from "@/lib/server/storage";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getConnection();
  return { title: c ? "Connection settings" : "Connect a bucket" };
}

export default async function SetupPage() {
  const c = await getConnection();

  return (
    <main id="main" className="relative isolate flex flex-1 flex-col items-center px-4 py-4 sm:px-6 sm:py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_56%_60%_at_50%_0%,color-mix(in_oklab,var(--brand)_9%,transparent),color-mix(in_oklab,var(--brand)_2.5%,transparent)_45%,transparent_75%)]"
      />
      <div className="my-auto grid w-full max-w-[460px] grid-cols-1 gap-4 sm:gap-5">
        <div className="grid justify-items-center gap-1.5 text-center">
          <div className="flex items-center gap-2.5">
            <Image
              src="/brand-mark.svg"
              alt=""
              width={32}
              height={32}
              priority
              className="size-8 rounded-[8px] shadow-[0_6px_20px_-6px_color-mix(in_oklab,var(--brand)_40%,transparent)]"
            />
            <p className="text-lg leading-7 font-semibold tracking-[-0.015em] text-text-1">{BRAND.name}</p>
          </div>
          {c ? null : <p className="text-sm text-pretty text-text-2">{BRAND.tagline}</p>}
        </div>

        <SetupForm
          connected={Boolean(c)}
          mockMode={isMockMode()}
          defaults={{ accessKeyId: c?.accessKeyId ?? "", bucket: c?.bucket ?? "" }}
          connection={
            c
              ? { bucket: c.bucket, region: c.region, regionName: regionName(c.region) }
              : null
          }
        />
      </div>
    </main>
  );
}
