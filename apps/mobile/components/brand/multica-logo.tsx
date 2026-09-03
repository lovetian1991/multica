import { Image } from "react-native";

interface MulticaLogoProps {
  size?: number;
}

export function MulticaLogo({ size = 48 }: MulticaLogoProps) {
  return (
    <Image
      source={require("../../assets/brand-mark.png")}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="鸿翼灵工"
    />
  );
}
