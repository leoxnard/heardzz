import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { adminAvailable, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!adminAvailable()) redirect("/");
  if (await isAdmin()) redirect("/admin");
  return <LoginForm />;
}
