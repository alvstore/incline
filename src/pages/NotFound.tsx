import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Globe } from "@/components/ui/cosmic-404";
import { useAuth } from "@/contexts/AuthContext";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" as const } },
};

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    console.warn("404 — Route not found:", location.pathname);
  }, [location.pathname]);

  const handleHome = () => {
    navigate(user ? "/home" : "/", { replace: true });
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-gradient-to-br from-muted via-muted to-primary px-4 py-10">
      {/* Ambient gradient blobs */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-primary/20 blur-3xl" />

      <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="order-2 mx-auto w-full max-w-[420px] lg:order-1"
        >
          <Globe />
        </motion.div>

        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
          className="order-1 text-center lg:order-2 lg:text-left"
        >
          <motion.p
            variants={fadeUp}
            className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-primary/80"
          >
            Error 404
          </motion.p>
          <motion.h1
            variants={fadeUp}
            className="bg-gradient-to-br from-white via-muted to-primary/25 bg-clip-text text-4xl font-bold leading-tight tracking-tight text-transparent sm:text-5xl lg:text-6xl"
          >
            Lost in space
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="mx-auto mt-4 max-w-md text-base leading-relaxed text-muted-foreground/80 lg:mx-0"
          >
            The page you're looking for has drifted off our radar. Let's get you back to safer orbit.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
          >
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              className="gap-2 border-primary-foreground/15 bg-card/5 text-primary-foreground backdrop-blur hover:bg-card/10 hover:text-primary-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Go Back
            </Button>
            <Button
              onClick={handleHome}
              className="gap-2 bg-gradient-to-r from-primary to-primary text-primary-foreground shadow-lg shadow-primary/20 hover:from-primary hover:to-primary"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              {user ? "Back to dashboard" : "Back to home"}
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default NotFound;
