import { Braces } from "lucide-react";

import { useTranslations } from "../hooks/use-translations";

export const VariableHint = ({ names }: { names: readonly string[] }) => {
  const t = useTranslations();
  return (
    <span className="flex items-center gap-2">
      <Braces aria-hidden="true" size={14} />
      {names.length
        ? t(names.length === 1 ? "variableRequested" : "variablesRequested", [
            names.map((name) => `{{${name}}}`).join(" ⦁ "),
          ])
        : t("variableRequested", ["{{variable}}"])}
    </span>
  );
};
