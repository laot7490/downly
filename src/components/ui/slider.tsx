import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

type SliderProps = SliderPrimitive.Root.Props & { thumbLabels?: [string, string] };

function Slider({ className, thumbLabels, ...props }: SliderProps) {
	return (
		<SliderPrimitive.Root data-slot="slider" className={cn("relative flex w-full touch-none select-none items-center", className)} {...props}>
			<SliderPrimitive.Control className="relative flex h-6 w-full items-center">
				<SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-border">
					<SliderPrimitive.Indicator className="absolute h-full bg-foreground/70" />
				</SliderPrimitive.Track>
				<SliderPrimitive.Thumb aria-label={thumbLabels?.[0]} className="block size-3.5 rounded-full border-2 border-foreground bg-background shadow-sm outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50" />
				<SliderPrimitive.Thumb aria-label={thumbLabels?.[1]} className="block size-3.5 rounded-full border-2 border-foreground bg-background shadow-sm outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50" />
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	)
}

export { Slider }
