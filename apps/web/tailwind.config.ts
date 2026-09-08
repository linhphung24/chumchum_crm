import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Bảng màu hồng đào
        brand: {
          50: '#FFF5F2',
          100: '#FFE8E1',
          200: '#FFCFC3',
          300: '#FFAB99',
          400: '#FF8570',
          500: '#FB6A52',
          600: '#E85238',
          700: '#C03E27',
          800: '#993322',
          900: '#7B2F22',
        },
        accent: {
          400: '#FFC48F',
          500: '#FFA94D',
          600: '#F08C2E',
        },
        cream: '#FFF9F6',
        ink: {
          DEFAULT: '#3D2B26',
          soft: '#7A6660',
          faint: '#A89690',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 3px rgba(123, 47, 34, 0.06), 0 4px 14px rgba(123, 47, 34, 0.05)',
        float: '0 6px 24px rgba(232, 82, 56, 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
