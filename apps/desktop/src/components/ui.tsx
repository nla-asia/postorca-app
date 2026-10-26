import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button
      type={type}
      className={`button ${variant} ${className}`}
      {...props}
    />
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal"
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <Dialog.Title className="modal-title">{title}</Dialog.Title>
          <Dialog.Description className="modal-description">
            {description}
          </Dialog.Description>
          <Dialog.Close
            className="icon-button modal-close"
            aria-label="Close dialog"
          >
            <X size={19} aria-hidden="true" />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
