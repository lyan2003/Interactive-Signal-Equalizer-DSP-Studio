export const metadata = {
  title: "Home - Open PRO",
  description: "Page description",
};

import PageIllustration from "@/components/page-illustration";
import Hero from "@/components/hero-home";


export default function Home() {
  return (
    <>
      <PageIllustration />
      <Hero />
    </>
  );
}
