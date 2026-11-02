import markUrl from "../assets/orca-mark.png";
import "./BrandMark.css";

/** Orca's logo, used as its avatar in chat and on the sign-in and loading screens. */
export default function BrandMark({
  small = false,
  large = false,
}: {
  small?: boolean;
  large?: boolean;
}) {
  const size = small ? "small" : large ? "large" : "";
  return (
    <span className={`brand-mark logo ${size}`}>
      <img src={markUrl} alt="" aria-hidden="true" />
    </span>
  );
}
