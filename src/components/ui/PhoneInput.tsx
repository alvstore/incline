import * as React from "react";
import { cn } from "@/lib/utils";

interface PhoneInputProps extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  value?: string;
  onChange?: (value: string) => void;
  countryCode?: string;
}

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, value = "", onChange, countryCode = "+91", ...props }, ref) => {
    // Strip the +91 / 91 / 091 / 0 country-prefix and return the bare 10-digit form
    const ccDigits = countryCode.replace(/\D/g, "");
    const stripPrefix = (val: string) => {
      let cleaned = (val || "").replace(/\D/g, "");
      // Bare country code with no number yet (e.g. seed value "+91") → show empty
      if (ccDigits && cleaned === ccDigits) return "";
      // 091XXXXXXXXXX → XXXXXXXXXX
      if (cleaned.length === 13 && cleaned.startsWith("0" + ccDigits)) {
        cleaned = cleaned.slice(1 + ccDigits.length);
      } else if (ccDigits && cleaned.startsWith(ccDigits) && cleaned.length > 10) {
        cleaned = cleaned.slice(ccDigits.length);
      }
      while (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
      return cleaned.slice(0, 10);
    };


    const displayValue = stripPrefix(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/\D/g, "").slice(0, 10);
      onChange?.(raw);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text");
      const cleaned = stripPrefix(pasted);
      onChange?.(cleaned);
    };

    return (
      <div className="flex">
        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm font-medium select-none">
          {countryCode}
        </span>
        <input
          type="tel"
          inputMode="numeric"
          className={cn(
            "flex h-10 w-full rounded-r-md rounded-l-none border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
          ref={ref}
          value={displayValue}
          onChange={handleChange}
          onPaste={handlePaste}
          placeholder="9876543210"
          maxLength={10}
          {...props}
        />
      </div>
    );
  }
);
PhoneInput.displayName = "PhoneInput";

export { PhoneInput };
