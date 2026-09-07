import { redirect } from "next/navigation";
import { paths } from "@multica/core/paths";

export default function Page() {
  redirect(paths.system.products());
}
