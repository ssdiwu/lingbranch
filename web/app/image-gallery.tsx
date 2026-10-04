
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, ImageOff, LoaderCircle, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";
import { Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import type { Attachment } from "@/lib/idea-store";

const imageUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

function GalleryImage({ file }: { file: Attachment }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  return <div className="atlas-gallery-image-wrap">
    {status === "loading" && <div className="atlas-gallery-image-status" role="status"><LoaderCircle className="atlas-image-spinner" size={24} />正在加载图片…</div>}
    {status === "error" && <div className="atlas-gallery-image-status" role="status"><ImageOff size={28} /><span>图片暂时无法加载</span><Button variant="outline" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>重试</Button></div>}
    <img key={attempt} src={imageUrl(file.id)} alt={file.name} className={status === "ready" ? "is-ready" : ""} draggable={false} onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />
  </div>;
}

export default function ImageGallery({ title, images, initialId, onClose, returnFocus }: {
  title: string;
  images: Attachment[];
  initialId: string;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const initialIndex = Math.max(0, images.findIndex(image => image.id === initialId));
  const [index, setIndex] = useState(initialIndex);
  const [api, setApi] = useState<CarouselApi>();
  const [reducedMotion, setReducedMotion] = useState(false);
  const thumbnails = useRef<HTMLDivElement>(null);
  const current = images[index];

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!api) return;
    const select = () => setIndex(api.selectedScrollSnap());
    select();
    api.on("select", select);
    api.on("reInit", select);
    return () => { api.off("select", select); api.off("reInit", select); };
  }, [api]);

  useEffect(() => {
    const strip = thumbnails.current;
    const active = strip?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!strip || !active) return;
    const left = active.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    if (left < strip.scrollLeft || left + active.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = left - (strip.clientWidth - active.offsetWidth) / 2;
    }
  }, [index]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") api?.scrollPrev();
    else if (event.key === "ArrowRight") api?.scrollNext();
    else if (event.key === "Home") api?.scrollTo(0);
    else if (event.key === "End") api?.scrollTo(images.length - 1);
    else return;
    event.preventDefault();
  };

  if (!current) return null;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogPortal>
    <DialogOverlay className="atlas-gallery-overlay" />
    <DialogPrimitive.Content className="atlas-gallery" onKeyDown={onKeyDown} onCloseAutoFocus={event => { event.preventDefault(); returnFocus?.focus(); }}>
      <header className="atlas-gallery-header">
        <div><DialogTitle>{title}</DialogTitle><DialogDescription>左右滑动浏览，或点选下方图片。</DialogDescription></div>
        <div className="atlas-gallery-header-actions"><a href={imageUrl(current.id)} download={current.name} aria-label={`下载 ${current.name}`} title="下载原图"><ArrowDownToLine size={20} /></a><DialogClose asChild><Button variant="ghost" className="atlas-gallery-icon" aria-label="关闭图片查看器"><X size={22} /></Button></DialogClose></div>
      </header>
      <Carousel className="atlas-gallery-carousel" opts={{ startIndex: initialIndex, loop: false, duration: reducedMotion ? 0 : 20 }} setApi={setApi} aria-label="灵感图片">
        <CarouselContent className="atlas-gallery-slides">
          {images.map((image, imageIndex) => <CarouselItem key={image.id} className="atlas-gallery-slide" aria-label={`第 ${imageIndex + 1} 张，共 ${images.length} 张`} aria-hidden={imageIndex !== index} inert={imageIndex !== index}>{Math.abs(imageIndex - index) <= 1 && <GalleryImage file={image} />}</CarouselItem>)}
        </CarouselContent>
        <Button variant="ghost" className="atlas-gallery-arrow is-previous" aria-label="上一张图片" disabled={index === 0} onClick={() => api?.scrollPrev()}><ChevronLeft size={28} /></Button>
        <Button variant="ghost" className="atlas-gallery-arrow is-next" aria-label="下一张图片" disabled={index === images.length - 1} onClick={() => api?.scrollNext()}><ChevronRight size={28} /></Button>
      </Carousel>
      <footer className="atlas-gallery-footer">
        <div className="atlas-gallery-caption" aria-live="polite" aria-atomic="true"><span className="atlas-gallery-count">{index + 1} / {images.length}</span><span>{current.name}</span></div>
        <div className="atlas-gallery-thumbnails" ref={thumbnails} aria-label="图片列表"><div className="atlas-gallery-thumbnail-track">{images.map((image, imageIndex) => <button key={image.id} type="button" className="atlas-gallery-thumbnail" aria-label={`查看第 ${imageIndex + 1} 张图片：${image.name}`} aria-pressed={imageIndex === index} onClick={() => api?.scrollTo(imageIndex)}><img src={imageUrl(image.id)} alt="" draggable={false} /><span>{imageIndex + 1}</span></button>)}</div></div>
      </footer>
    </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>;
}
