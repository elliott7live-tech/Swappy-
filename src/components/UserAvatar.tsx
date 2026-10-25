import React, { useEffect, useState } from 'react';

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  color?: string | null;
  alt?: string;
  className?: string;
  textClassName?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  src,
  name,
  color,
  alt,
  className = 'w-10 h-10',
  textClassName = 'text-xs',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const initial = (name || 'S').trim().slice(0, 1).toUpperCase() || 'S';
  const bgColor = color && color.startsWith('#') ? color : '#FE2C55';
  const showImage = Boolean(src && src.trim() && !imgFailed);

  return (
    <span
      style={showImage ? undefined : { backgroundColor: bgColor }}
      className={`relative rounded-full overflow-hidden flex items-center justify-center font-extrabold text-white select-none ${
        showImage ? 'bg-zinc-900' : ''
      } ${className}`}
    >
      {showImage ? (
        <img
          src={src!}
          alt={alt || `Zdjęcie profilowe ${name || 'użytkownika'}`}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className={textClassName}>{initial}</span>
      )}
    </span>
  );
};
