import type { InputHTMLAttributes } from "react";

export function Checkbox(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ui-checkbox" type="checkbox" {...props} />;
}
