declare module "georaster" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function parseGeoraster(input: string | ArrayBuffer): Promise<any>;
  export default parseGeoraster;
}

declare module "georaster-layer-for-leaflet" {
  import L from "leaflet";
  interface GeoRasterLayerOptions extends L.GridLayerOptions {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    georaster?: any;
    georasterUrl?: string;
    opacity?: number;
    resolution?: number;
    pane?: string;
  }
  class GeoRasterLayer extends L.GridLayer {
    constructor(options: GeoRasterLayerOptions);
    setOpacity(opacity: number): this;
  }
  export default GeoRasterLayer;
}
