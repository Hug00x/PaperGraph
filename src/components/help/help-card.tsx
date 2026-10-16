import type { ReactNode } from "react";
import { HelpArrow } from "./help-arrow";

type Props = {
  title: string;
  description: string;
  onClick: () => void;
  footer?: ReactNode;
};

export function HelpCard({ title, description, onClick, footer }: Props) {
  return (
    <button type="button" className="help-card" onClick={onClick}>
      <strong>{title}</strong>
      <span>{description}</span>
      {footer ? <small>{footer} <HelpArrow /></small> : <HelpArrow />}
    </button>
  );
}
