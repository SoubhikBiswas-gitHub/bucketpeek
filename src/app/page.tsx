import { redirect } from "next/navigation";
import { getConnection } from "@/lib/server/session";

// One hop to where the user belongs, instead of bouncing through /browse's guard.
export default async function Home() {
  redirect((await getConnection()) ? "/browse" : "/setup");
}
