import React, { useEffect, useState } from 'react';
import { YOUTUBE_API_BASE } from '../constants';
import {
    fetchEncryptedImageBlobUrl,
    getCachedEncryptedImageBlobUrl
} from '../utils/encryptionUtils';

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src?: string;
    encryptionEnabled: boolean;
    fallback?: React.ReactNode;
}

export const SmartImage: React.FC<SmartImageProps> = React.memo(
    ({ src, encryptionEnabled, fallback = null, className, ...rest }) => {
        const [resolvedSrc, setResolvedSrc] = useState<string>(() => {
            if (!src) return '';
            if (!encryptionEnabled) return src;
            return getCachedEncryptedImageBlobUrl(src) || '';
        });
        const [hasError, setHasError] = useState(false);

        useEffect(() => {
            setHasError(false);
            if (!src) {
                setResolvedSrc('');
                return;
            }

            // מסלול ללא הצפנה: URL ישיר ונקי בלי שום Base64 ובלי XOR
            if (!encryptionEnabled) {
                setResolvedSrc(src);
                return;
            }

            // בדיקה סינכרונית במטמון כדי למנוע הבהוב בעת מעבר בין תמונה קטנה לגדולה
            const cached = getCachedEncryptedImageBlobUrl(src);
            if (cached) {
                setResolvedSrc(cached);
                return;
            }

            // מסלול מוצפן: הורדת התמונה המוצפנת ברקע (משאירים את התמונה הקיימת עד שהחדשה מוכנה כדי למנוע הבהוב)
            let cancelled = false;

            fetchEncryptedImageBlobUrl(YOUTUBE_API_BASE, src).then((blobUrl) => {
                if (!cancelled) {
                    if (blobUrl) {
                        setResolvedSrc(blobUrl);
                    } else {
                        setResolvedSrc((prev) => {
                            if (!prev) setHasError(true);
                            return prev;
                        });
                    }
                }
            });

            return () => {
                cancelled = true;
            };
        }, [src, encryptionEnabled]);

        if (!src || (hasError && !resolvedSrc) || !resolvedSrc) {
            return <>{fallback}</>;
        }

        return (
            <img
                src={resolvedSrc}
                className={className}
                onError={() => {
                    if (!resolvedSrc.startsWith('blob:')) {
                        setHasError(true);
                    }
                }}
                {...rest}
            />
        );
    }
);
