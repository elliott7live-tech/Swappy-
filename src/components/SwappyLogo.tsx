import React from 'react';

interface SwappyLogoProps {
  showWordmark?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const SwappyLogo: React.FC<SwappyLogoProps> = ({
  showWordmark = true,
  size = 'md',
}) => {
  const iconDimensions =
    size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-11 h-11' : 'w-8 h-8';
  const textClass =
    size === 'sm'
      ? 'text-lg'
      : size === 'lg'
        ? 'text-2xl'
        : 'text-xl';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        viewBox="0 0 64 64"
        fill="none"
        className={`${iconDimensions} shrink-0`}
        aria-hidden="true"
      >
        <rect width="64" height="64" rx="16" fill="#141418" />
        <path
          d="M40 16H25C20.5 16 17 19.5 17 24C17 28 19.8 31.2 23.8 32L36.2 34.4C37.8 34.7 39 36.1 39 37.8C39 39.6 37.5 41 35.6 41H20V47H36C41 47 45 43 45 38C45 33.6 41.9 30 37.6 29.1L25.2 26.7C23.9 26.4 23 25.3 23 24C23 22.3 24.4 21 26 21H40V16Z"
          fill="#25F4EE"
          transform="translate(-2.2, -1.8)"
        />
        <path
          d="M40 16H25C20.5 16 17 19.5 17 24C17 28 19.8 31.2 23.8 32L36.2 34.4C37.8 34.7 39 36.1 39 37.8C39 39.6 37.5 41 35.6 41H20V47H36C41 47 45 43 45 38C45 33.6 41.9 30 37.6 29.1L25.2 26.7C23.9 26.4 23 25.3 23 24C23 22.3 24.4 21 26 21H40V16Z"
          fill="#FE2C55"
          transform="translate(2.2, 1.8)"
        />
        <path
          d="M40 16H25C20.5 16 17 19.5 17 24C17 28 19.8 31.2 23.8 32L36.2 34.4C37.8 34.7 39 36.1 39 37.8C39 39.6 37.5 41 35.6 41H20V47H36C41 47 45 43 45 38C45 33.6 41.9 30 37.6 29.1L25.2 26.7C23.9 26.4 23 25.3 23 24C23 22.3 24.4 21 26 21H40V16Z"
          fill="#FFFFFF"
        />
      </svg>
      {showWordmark && (
        <span className={`${textClass} font-extrabold tracking-tight text-white`}>
          Swappy
        </span>
      )}
    </span>
  );
};
