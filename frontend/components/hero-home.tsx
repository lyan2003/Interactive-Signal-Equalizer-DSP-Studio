import Image from "next/image";
import Link from "next/link";
import HomeImage from "@/public/images/home-image.jpg";

export default function HeroHome() {
  return (
    <section className="relative flex min-h-screen">

      {/* 🔸 Main Content */}
      <div
        className="ml-[25%] flex-1 bg-cover bg-center flex flex-col justify-start items-center pt-10"
        style={{ backgroundImage: "url('/images/background.jpg')" }}
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col justify-start items-center mt-8">
          <div className="text-center">
            <h1
              className="animate-[gradient_6s_linear_infinite] bg-[linear-gradient(to_right,#E0E0E0,#FF7B00,#F5F5F5,#FF7B00,#E0E0E0)] bg-[length:200%_auto] bg-clip-text pb-3 font-nacelle text-6xl font-bold text-transparent md:text-7xl"
              data-aos="fade-up"
            >
              Signal Equalizer
            </h1>

            <p
              className="text-2xl text-gray-700 mb-10"
              data-aos="fade-up"
              data-aos-delay={200}
            >
              Shape your sound, your way — because every frequency tells a story
            </p>

            {/* 🔸 الصورة المدمجة أسفل النص */}
            <div
              className="relative flex justify-center items-center w-full"
              data-aos="fade-up"
              data-aos-delay={400}
            >
              <div className="relative w-[700px] md:w-[850px] h-[400px] md:h-[450px] opacity-85 mix-blend-overlay hover:opacity-95 transition-all duration-700">
                <Image
                  src={HomeImage}
                  alt="Equalizer visual"
                  className="rounded-2xl object-contain opacity-80 mix-blend-screen"
                  fill
                  sizes="(max-width: 768px) 90vw, 850px"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
