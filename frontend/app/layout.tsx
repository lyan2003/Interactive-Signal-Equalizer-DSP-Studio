"use client";
import "./css/style.css";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import { useState } from "react";
import Link from "next/link";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const nacelle = localFont({
  src: [
    { path: "../public/fonts/nacelle-regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/nacelle-italic.woff2", weight: "400", style: "italic" },
    { path: "../public/fonts/nacelle-semibold.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/nacelle-semibolditalic.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-nacelle",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState("Select mode");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleToggleDropdown = () => setDropdownOpen(!dropdownOpen);

  const handleSelectMode = (selected: string) => {
    setMode(selected);
    setDropdownOpen(false);
  };

  return (
    <html lang="en">
      <body
        style={{
          backgroundImage: "url('/images/background.jpeg')",
          backgroundSize: "cover",
          backgroundPosition: "center center",
          backgroundRepeat: "no-repeat",
          backgroundAttachment: "fixed",
        }}
        className="font-sans"
      >
        <div className="flex-1 flex flex-col">
          <div className="flex justify-start items-start p-4 relative">
            <div className="relative inline-block">
              <button
                onClick={handleToggleDropdown}
                className="appearance-none px-4 py-2 rounded-lg border border-gray-600
                  bg-[#1a1a1a]/70 text-orange-500 font-semibold
                  focus:outline-none focus:ring-2 focus:ring-orange-400
                  backdrop-blur-sm"
              >
                {mode}
              </button>

              {dropdownOpen && (
                <div className="absolute mt-2 w-64 rounded-lg bg-[#1a1a1a]/90 backdrop-blur-sm border border-gray-700 shadow-lg z-10">
                  <Link
                    href="/generic-mode"
                    className="block px-4 py-2 hover:bg-orange-500 hover:text-black"
                    onClick={() => handleSelectMode("Generic mode")}
                  >
                    Generic mode
                  </Link>
                  <Link
                    href="/musical_mode"
                    className="block px-4 py-2 hover:bg-orange-500 hover:text-black"
                    onClick={() => handleSelectMode("Musical instruments mode")}
                  >
                    Musical instruments mode
                  </Link>
                  <Link
                    href="/human-mode"
                    className="block px-4 py-2 hover:bg-orange-500 hover:text-black"
                    onClick={() => handleSelectMode("Human voice mode")}
                  >
                    Human voice mode
                  </Link>
                  <Link
                    href="/animal_mode"
                    className="block px-4 py-2 hover:bg-orange-500 hover:text-black"
                    onClick={() => handleSelectMode("Animal mode")}
                  >
                    Animal mode
                  </Link>
                </div>
              )}
            </div>
          </div>

          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
