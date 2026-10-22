"""xlsx2echarts — convert native Excel charts (DrawingML) in .xlsx files to Apache ECharts options."""
from .converter import convert_xlsx
from .version import __version__

__all__ = ["convert_xlsx", "__version__"]
