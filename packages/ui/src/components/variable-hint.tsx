import { Braces } from "lucide-react";

export const VariableHint = ({ names }: { names: readonly string[] }) => (
  <span className="flex items-center gap-2">
    <Braces aria-hidden="true" size={14} />
    {names.length
      ? `${names.map((name) => `{{${name}}}`).join(" ⦁ ")} ${names.length === 1 ? "is" : "are"} requested when copying`
      : "{{variable}} is requested when copying"}
  </span>
);
